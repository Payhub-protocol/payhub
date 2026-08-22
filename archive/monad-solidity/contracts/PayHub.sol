// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PayHub
 * @notice Chargeback and dispute rail for compliant stablecoins (A-Token) on Monad.
 *
 * Payment lifecycle:
 *   PENDING  → customer pays, funds held in contract during finality window
 *   SETTLED  → merchant claims after window; no dispute possible
 *   DISPUTED → customer opens dispute before window closes
 *   RESOLVED → arbiter or timeout resolves in favour of customer (refunded) or merchant (released)
 *   REFUNDED → funds returned to original payer wallet
 *
 * Cleanverse integration points (enforced off-chain by backend before tx):
 *   - A-Pass: payer + merchant both verified before initiatePayment is called
 *   - CCP: pre-screened before payment AND before refund execution
 *   - Travel Rule: metadata attached by backend to every payment/refund event
 */
contract PayHub is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ─── Types ────────────────────────────────────────────────────────────────

    enum Status { PENDING, SETTLED, DISPUTED, REFUNDED }

    struct Payment {
        bytes32  id;
        address  payer;          // A-Pass verified customer wallet
        address  merchant;       // A-Pass verified merchant wallet
        address  token;          // A-Token contract address
        uint256  amount;
        uint256  createdAt;
        uint256  finalityWindow; // seconds until merchant can claim
        uint256  disputeWindow;  // seconds after creation customer can dispute
        Status   status;
        string   orderId;        // off-chain reference
        string   apassPayer;     // Cleanverse A-Pass ID (for audit)
        string   apassMerchant;
    }

    struct Dispute {
        bytes32 paymentId;
        string  reason;
        uint256 openedAt;
        uint256 responseDeadline; // merchant response window
        bool    merchantResponded;
        string  merchantEvidence;
        address resolvedFor;     // address(0) until resolved
    }

    // ─── State ────────────────────────────────────────────────────────────────

    mapping(bytes32 => Payment) public payments;
    mapping(bytes32 => Dispute) public disputes;
    mapping(address => bytes32[]) public payerPayments;
    mapping(address => bytes32[]) public merchantPayments;

    address public arbiter;           // backend EOA that can resolve disputes
    uint256 public defaultFinality  = 3 days;
    uint256 public defaultDisputeWindow = 2 days;
    uint256 public merchantResponseWindow = 24 hours;
    uint256 public platformFeeBps   = 50; // 0.5%
    address public feeRecipient;

    // ─── Events ───────────────────────────────────────────────────────────────

    event PaymentInitiated(
        bytes32 indexed paymentId,
        address indexed payer,
        address indexed merchant,
        address token,
        uint256 amount,
        string orderId,
        uint256 finalityDeadline
    );
    event PaymentSettled(bytes32 indexed paymentId, address merchant, uint256 amount);
    event DisputeOpened(bytes32 indexed paymentId, address indexed payer, string reason, uint256 responseDeadline);
    event MerchantResponded(bytes32 indexed paymentId, string evidence);
    event DisputeResolved(bytes32 indexed paymentId, address resolvedFor, string verdict);
    event PaymentRefunded(bytes32 indexed paymentId, address indexed payer, uint256 amount);

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyArbiter() {
        require(msg.sender == arbiter || msg.sender == owner(), "Not arbiter");
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address _arbiter, address _feeRecipient) Ownable(msg.sender) {
        arbiter     = _arbiter;
        feeRecipient = _feeRecipient;
    }

    // ─── Core payment flow ────────────────────────────────────────────────────

    /**
     * @notice Customer initiates a payment. Backend must pre-verify both
     *         A-Pass identities and CCP-clear the transfer before calling.
     * @param merchant      Verified merchant wallet
     * @param token         A-Token contract address
     * @param amount        Gross amount (fee deducted on settlement)
     * @param orderId       Off-chain order reference
     * @param apassPayer    Payer's Cleanverse A-Pass identifier (audit trail)
     * @param apassMerchant Merchant's Cleanverse A-Pass identifier
     * @param customFinality Override default finality window (0 = use default)
     */
    function initiatePayment(
        address merchant,
        address token,
        uint256 amount,
        string calldata orderId,
        string calldata apassPayer,
        string calldata apassMerchant,
        uint256 customFinality
    ) external nonReentrant returns (bytes32 paymentId) {
        require(merchant != address(0) && merchant != msg.sender, "Invalid merchant");
        require(amount > 0, "Amount must be > 0");
        require(bytes(apassPayer).length > 0 && bytes(apassMerchant).length > 0, "A-Pass IDs required");

        uint256 finality = customFinality > 0 ? customFinality : defaultFinality;

        paymentId = keccak256(abi.encodePacked(
            msg.sender, merchant, token, amount, orderId, block.timestamp
        ));
        require(payments[paymentId].createdAt == 0, "Payment ID collision");

        // Pull funds from payer into escrow
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        payments[paymentId] = Payment({
            id:             paymentId,
            payer:          msg.sender,
            merchant:       merchant,
            token:          token,
            amount:         amount,
            createdAt:      block.timestamp,
            finalityWindow: finality,
            disputeWindow:  defaultDisputeWindow,
            status:         Status.PENDING,
            orderId:        orderId,
            apassPayer:     apassPayer,
            apassMerchant:  apassMerchant
        });

        payerPayments[msg.sender].push(paymentId);
        merchantPayments[merchant].push(paymentId);

        emit PaymentInitiated(
            paymentId,
            msg.sender,
            merchant,
            token,
            amount,
            orderId,
            block.timestamp + finality
        );
    }

    /**
     * @notice Merchant claims settled funds after the finality window.
     *         Backend CCP-clears outgoing transfer before merchant calls this.
     */
    function claimPayment(bytes32 paymentId) external nonReentrant {
        Payment storage p = payments[paymentId];
        require(p.status == Status.PENDING, "Payment not claimable");
        require(p.merchant == msg.sender, "Not the merchant");
        require(block.timestamp >= p.createdAt + p.finalityWindow, "Finality window active");

        p.status = Status.SETTLED;

        uint256 fee = (p.amount * platformFeeBps) / 10_000;
        uint256 merchantAmount = p.amount - fee;

        if (fee > 0) IERC20(p.token).safeTransfer(feeRecipient, fee);
        IERC20(p.token).safeTransfer(p.merchant, merchantAmount);

        emit PaymentSettled(paymentId, p.merchant, merchantAmount);
    }

    /**
     * @notice Payer opens a dispute. Only the verified identity that paid can
     *         call this — enforced both here (msg.sender) and by A-Pass check
     *         in the backend before the tx is submitted.
     */
    function openDispute(bytes32 paymentId, string calldata reason) external {
        Payment storage p = payments[paymentId];
        require(p.status == Status.PENDING, "Payment not disputable");
        require(p.payer == msg.sender, "Only payer can dispute");
        require(
            block.timestamp <= p.createdAt + p.disputeWindow,
            "Dispute window closed"
        );
        require(bytes(reason).length > 0, "Reason required");
        require(disputes[paymentId].openedAt == 0, "Dispute already open");

        p.status = Status.DISPUTED;

        uint256 responseDeadline = block.timestamp + merchantResponseWindow;
        disputes[paymentId] = Dispute({
            paymentId:         paymentId,
            reason:            reason,
            openedAt:          block.timestamp,
            responseDeadline:  responseDeadline,
            merchantResponded: false,
            merchantEvidence:  "",
            resolvedFor:       address(0)
        });

        emit DisputeOpened(paymentId, msg.sender, reason, responseDeadline);
    }

    /**
     * @notice Merchant submits evidence within the response window.
     */
    function respondToDispute(bytes32 paymentId, string calldata evidence) external {
        Payment storage p = payments[paymentId];
        Dispute storage d = disputes[paymentId];
        require(p.status == Status.DISPUTED, "No open dispute");
        require(p.merchant == msg.sender, "Not the merchant");
        require(block.timestamp <= d.responseDeadline, "Response window closed");
        require(!d.merchantResponded, "Already responded");

        d.merchantResponded = true;
        d.merchantEvidence  = evidence;

        emit MerchantResponded(paymentId, evidence);
    }

    /**
     * @notice Arbiter (or owner) resolves a dispute.
     *         inFavorOfPayer=true  → refund to original payer
     *         inFavorOfPayer=false → release to merchant
     * @param verdict Human-readable resolution note (stored in event for audit)
     */
    function resolveDispute(
        bytes32 paymentId,
        bool inFavorOfPayer,
        string calldata verdict
    ) external nonReentrant onlyArbiter {
        Payment storage p = payments[paymentId];
        Dispute storage d = disputes[paymentId];
        require(p.status == Status.DISPUTED, "No open dispute");

        address resolvedFor = inFavorOfPayer ? p.payer : p.merchant;
        d.resolvedFor = resolvedFor;

        if (inFavorOfPayer) {
            _refund(paymentId, p);
        } else {
            p.status = Status.SETTLED;
            uint256 fee = (p.amount * platformFeeBps) / 10_000;
            uint256 merchantAmount = p.amount - fee;
            if (fee > 0) IERC20(p.token).safeTransfer(feeRecipient, fee);
            IERC20(p.token).safeTransfer(p.merchant, merchantAmount);
            emit PaymentSettled(paymentId, p.merchant, merchantAmount);
        }

        emit DisputeResolved(paymentId, resolvedFor, verdict);
    }

    /**
     * @notice Auto-resolve a dispute in payer's favour if merchant missed the
     *         response window. Anyone can call this to unblock the payer.
     */
    function autoResolveExpiredDispute(bytes32 paymentId) external nonReentrant {
        Payment storage p = payments[paymentId];
        Dispute storage d = disputes[paymentId];
        require(p.status == Status.DISPUTED, "No open dispute");
        require(!d.merchantResponded, "Merchant responded - needs arbiter");
        require(block.timestamp > d.responseDeadline, "Response window still open");

        d.resolvedFor = p.payer;
        _refund(paymentId, p);
        emit DisputeResolved(paymentId, p.payer, "Auto: merchant did not respond");
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _refund(bytes32 paymentId, Payment storage p) internal {
        p.status = Status.REFUNDED;
        // Refund-to-source: always back to the original verified payer wallet
        IERC20(p.token).safeTransfer(p.payer, p.amount);
        emit PaymentRefunded(paymentId, p.payer, p.amount);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getPayment(bytes32 paymentId) external view returns (Payment memory) {
        return payments[paymentId];
    }

    function getDispute(bytes32 paymentId) external view returns (Dispute memory) {
        return disputes[paymentId];
    }

    function getPayerPayments(address payer) external view returns (bytes32[] memory) {
        return payerPayments[payer];
    }

    function getMerchantPayments(address merchant) external view returns (bytes32[] memory) {
        return merchantPayments[merchant];
    }

    function isDisputeWindowOpen(bytes32 paymentId) external view returns (bool) {
        Payment storage p = payments[paymentId];
        return p.status == Status.PENDING &&
               block.timestamp <= p.createdAt + p.disputeWindow;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setArbiter(address _arbiter) external onlyOwner { arbiter = _arbiter; }
    function setDefaultFinality(uint256 secs) external onlyOwner { defaultFinality = secs; }
    function setDefaultDisputeWindow(uint256 secs) external onlyOwner { defaultDisputeWindow = secs; }
    function setMerchantResponseWindow(uint256 secs) external onlyOwner { merchantResponseWindow = secs; }
    function setPlatformFee(uint256 bps) external onlyOwner { require(bps <= 200, "Max 2%"); platformFeeBps = bps; }
    function setFeeRecipient(address r) external onlyOwner { require(r != address(0)); feeRecipient = r; }
}
