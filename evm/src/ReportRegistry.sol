// evm/src/ReportRegistry.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/// Write-once commitment of CRE settlement report hashes: campaignId => reportHash.
/// Holds no funds. Only the configured CRE forwarder may write.
contract ReportRegistry is IReceiver {
    address public immutable forwarder;
    mapping(bytes32 => bytes32) public reportHash;

    event ReportCommitted(bytes32 indexed campaignId, bytes32 reportHash);

    error UnauthorizedForwarder(address caller);
    error ConflictingCommitment(bytes32 campaignId, bytes32 existing, bytes32 attempted);
    error EmptyHash();

    constructor(address forwarder_) {
        forwarder = forwarder_;
    }

    function onReport(bytes calldata, bytes calldata report) external override {
        if (msg.sender != forwarder) revert UnauthorizedForwarder(msg.sender);
        (bytes32 campaignId, bytes32 hash) = abi.decode(report, (bytes32, bytes32));
        if (hash == bytes32(0)) revert EmptyHash();
        bytes32 existing = reportHash[campaignId];
        if (existing == hash) return; // idempotent retry
        if (existing != bytes32(0)) revert ConflictingCommitment(campaignId, existing, hash);
        reportHash[campaignId] = hash;
        emit ReportCommitted(campaignId, hash);
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
