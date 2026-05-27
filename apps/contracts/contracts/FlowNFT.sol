// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract FlowNFT is ERC721, Ownable {
    using Strings for uint256;

    struct ReceiptData {
        uint256 jobId;
        uint256 score;
        address freelancer;
        uint256 mintedAt;
    }

    mapping(uint256 => ReceiptData) public receipts;
    address public minter;
    uint256 private _nextTokenId;

    event MinterSet(address indexed minter);
    event ReceiptMinted(uint256 indexed tokenId, uint256 indexed jobId, address freelancer);

    error OnlyMinter();
    error MinterAlreadySet();
    error ZeroAddress();

    constructor() ERC721("PayStream Receipt", "PSRX") Ownable(msg.sender) {}

    function setMinter(address _minter) external onlyOwner {
        if (minter != address(0)) revert MinterAlreadySet();
        if (_minter == address(0)) revert ZeroAddress();
        minter = _minter;
        emit MinterSet(_minter);
    }

    function mintReceipt(
        address to,
        uint256 jobId,
        uint256 score
    ) external returns (uint256 tokenId) {
        if (msg.sender != minter) revert OnlyMinter();
        if (to == address(0)) revert ZeroAddress();

        tokenId = _nextTokenId++;
        receipts[tokenId] = ReceiptData({
            jobId: jobId,
            score: score,
            freelancer: to,
            mintedAt: block.timestamp
        });

        _mint(to, tokenId);
        emit ReceiptMinted(tokenId, jobId, to);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        ReceiptData memory d = receipts[tokenId];

        string memory json = string.concat(
            '{"name":"PayStream Receipt #', tokenId.toString(), '",',
            '"description":"Proof of work completion and payment on PayFi PayStream.",',
            '"attributes":[',
              '{"trait_type":"Job ID","value":', d.jobId.toString(), '},',
              '{"trait_type":"Completion Score","value":', d.score.toString(), '},',
              '{"trait_type":"Freelancer","value":"', Strings.toHexString(d.freelancer), '"},',
              '{"trait_type":"Minted At","value":', d.mintedAt.toString(), '}',
            ']}'
        );

        return string.concat(
            "data:application/json;base64,",
            Base64.encode(bytes(json))
        );
    }
}
