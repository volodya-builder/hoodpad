// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title FeeClaimer — сбор комиссий протокола со всех пулов одной транзакцией.
/// @notice У каждого пула есть claimProtocolFees() без ограничений по вызову:
///         деньги всегда уходят в казну фабрики, кто бы ни нажал. Раньше
///         владелец подписывал по транзакции на пул — здесь один вызов на всё.
///         Пул, у которого клейм упал (нет накоплений, редкий сбой), просто
///         пропускается — остальные всё равно собираются.
interface IPoolClaim {
    function claimProtocolFees() external;
    function protocolFeesAccrued() external view returns (uint256);
}

contract FeeClaimer {
    event Claimed(uint256 pools, uint256 ok);

    /// @param pools адреса пулов (ETH-фабрика и квот-фабрика — интерфейс одинаковый)
    function claimAll(address[] calldata pools) external returns (uint256 ok) {
        for (uint256 i = 0; i < pools.length; i++) {
            try IPoolClaim(pools[i]).claimProtocolFees() { ok++; } catch {}
        }
        emit Claimed(pools.length, ok);
    }

    /// @notice Только пулы с ненулевым остатком — чтобы не жечь газ впустую.
    function pending(address[] calldata pools) external view returns (address[] memory out) {
        uint256 n;
        for (uint256 i = 0; i < pools.length; i++) {
            try IPoolClaim(pools[i]).protocolFeesAccrued() returns (uint256 a) { if (a > 0) n++; } catch {}
        }
        out = new address[](n);
        uint256 k;
        for (uint256 i = 0; i < pools.length; i++) {
            try IPoolClaim(pools[i]).protocolFeesAccrued() returns (uint256 a) { if (a > 0) out[k++] = pools[i]; } catch {}
        }
    }
}
