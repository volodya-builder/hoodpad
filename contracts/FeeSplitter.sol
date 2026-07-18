// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title FeeSplitter
/// @notice Splits every incoming ETH payment between the team wallet and
///         the BuybackTreasury at an immutable ratio. Used as the factory's
///         `treasury` so pools need no changes: they keep sending the
///         protocol share to one address, and the split happens here.
///
///         With creator share 40% and teamBps = 3333 (1/3 of the remaining
///         60%), the effective split of each trade's fee is:
///           40% creator · 20% team · 40% buyback treasury.
contract FeeSplitter {
    address public immutable team;
    address public immutable buyback;
    uint16 public immutable teamBps; // team's share of INCOMING funds, in bps

    event Split(uint256 toTeam, uint256 toBuyback);

    constructor(address team_, address buyback_, uint16 teamBps_) {
        require(team_ != address(0) && buyback_ != address(0), "zero addr");
        require(teamBps_ <= 10_000, "bps>100%");
        team = team_;
        buyback = buyback_;
        teamBps = teamBps_;
    }

    receive() external payable {
        uint256 toTeam = (msg.value * teamBps) / 10_000;
        uint256 toBuyback = msg.value - toTeam;
        if (toTeam > 0) {
            (bool a, ) = team.call{value: toTeam}("");
            require(a, "team send failed");
        }
        if (toBuyback > 0) {
            (bool b, ) = buyback.call{value: toBuyback}("");
            require(b, "buyback send failed");
        }
        emit Split(toTeam, toBuyback);
    }
}
