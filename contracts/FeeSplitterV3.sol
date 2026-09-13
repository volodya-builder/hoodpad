// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IPoolToken {
    function token() external view returns (address);
}

interface IAgentTreasury {
    function fund(address token) external payable;
}

/// @title FeeSplitterV3
/// @notice Splits the protocol share of every trade fee between the team and
///         the token's own AI-agent budget. Used as the factory's `treasury`,
///         so pools need no changes: they keep sending the protocol share to
///         one address and the split happens here.
///
///         With creatorFeeShareBps = 7000 on the pool, this contract receives
///         30% of each trade fee. Splitting that 2/3 : 1/3 yields the economics
///         fixed by the owner on 13.09.2026:
///
///             creator 70%  ·  team 20%  ·  AI agent 10%
///
///         The agent budget is per token: a token's own trading volume pays for
///         its own agent, and a dead token stops costing the platform anything.
///         Attribution works because `claimProtocolFees()` sends ETH from the
///         pool itself, so `msg.sender` here is that pool and we can ask it
///         which token it belongs to.
contract FeeSplitterV3 {
    address public immutable team;
    address public immutable agentTreasury;

    /// @notice Team's share of INCOMING funds, in bps. 6667 => 20% of a 1% fee.
    uint16 public immutable teamBps;

    event Split(address indexed token, uint256 toTeam, uint256 toAgent);

    constructor(address team_, address agentTreasury_, uint16 teamBps_) {
        require(team_ != address(0) && agentTreasury_ != address(0), "zero addr");
        require(teamBps_ <= 10_000, "bps>100%");
        team = team_;
        agentTreasury = agentTreasury_;
        teamBps = teamBps_;
    }

    receive() external payable {
        uint256 toTeam = (msg.value * teamBps) / 10_000;
        uint256 toAgent = msg.value - toTeam;

        // Which token paid? The sender is the pool; ask it. A sender that is
        // not a pool (a direct donation, say) simply has no token to credit,
        // and its whole amount goes to the team rather than reverting.
        address token = address(0);
        try IPoolToken(msg.sender).token() returns (address t) {
            token = t;
        } catch {}

        if (token == address(0)) {
            toTeam = msg.value;
            toAgent = 0;
        }

        if (toAgent > 0) {
            // A failing agent treasury must never block fee collection:
            // fall back to the team instead of reverting the claim.
            try IAgentTreasury(agentTreasury).fund{value: toAgent}(token) {}
            catch {
                toTeam += toAgent;
                toAgent = 0;
            }
        }

        if (toTeam > 0) {
            (bool ok, ) = team.call{value: toTeam}("");
            require(ok, "team send failed");
        }

        emit Split(token, toTeam, toAgent);
    }
}
