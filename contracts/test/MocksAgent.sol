// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Пул, каким его видит сплиттер: умеет назвать свой токен и переслать ETH
/// тем же способом, что боевой BondingCurvePoolV2 — call со всем газом.
contract MockPool {
    address public token;
    constructor(address token_) { token = token_; }
    receive() external payable {}
    function claimTo(address to, uint256 amount) external {
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "ETH send failed");
    }
}

/// Отправитель без token() — например, прямое пожертвование на адрес сплиттера.
contract NotAPool {
    receive() external payable {}
    function sendTo(address to, uint256 amount) external {
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "ETH send failed");
    }
}

/// Сломанная казна агента: fund() всегда падает. Нужна, чтобы проверить,
/// что выплата комиссий из-за неё не встаёт.
contract BrokenTreasury {
    function fund(address) external payable { revert("broken"); }
}

/// Получатель, который не принимает ETH — чтобы увидеть, что тогда будет.
contract RejectingTeam {
    receive() external payable { revert("no thanks"); }
}
