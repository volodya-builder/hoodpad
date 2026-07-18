// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title LaunchToken
/// @notice Fixed-supply ERC20. The entire supply is minted once to the
///         bonding-curve pool at creation. No owner, no mint, no pause,
///         no blacklist — fully immutable and trustless.
contract LaunchToken is ERC20 {
    /// @notice Off-chain metadata (image, description, socials) — immutable.
    string public metadataURI;

    constructor(
        string memory name_,
        string memory symbol_,
        string memory metadataURI_,
        address pool_,
        uint256 totalSupply_
    ) ERC20(name_, symbol_) {
        metadataURI = metadataURI_;
        _mint(pool_, totalSupply_);
    }
}
