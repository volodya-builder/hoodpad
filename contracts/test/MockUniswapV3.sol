// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Мок пула Uniswap V3: хранит цену, которую можно задать заранее
///      (имитация атаки «пул создан до градации по искажённой цене»).
contract MockV3Pool {
    uint160 public price;

    constructor(uint160 price_) { price = price_; }

    function slot0()
        external
        view
        returns (uint160, int24, uint16, uint16, uint16, uint8, bool)
    {
        return (price, 0, 0, 0, 0, 0, true);
    }
}

/// @dev Мок NonfungiblePositionManager: повторяет ключевое поведение —
///      createAndInitializePoolIfNecessary инициализирует пул ТОЛЬКО если
///      он ещё не создан, иначе молча возвращает существующий.
contract MockPositionManager {
    mapping(bytes32 => address) public pools;
    uint256 public nextId = 1;

    function key(address a, address b, uint24 fee) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(a, b, fee));
    }

    /// @notice Заранее создать пул по произвольной цене (роль атакующего).
    function preCreate(address token0, address token1, uint24 fee, uint160 sqrtPriceX96)
        external
        returns (address)
    {
        bytes32 k = key(token0, token1, fee);
        require(pools[k] == address(0), "exists");
        address p = address(new MockV3Pool(sqrtPriceX96));
        pools[k] = p;
        return p;
    }

    function createAndInitializePoolIfNecessary(
        address token0,
        address token1,
        uint24 fee,
        uint160 sqrtPriceX96
    ) external payable returns (address pool) {
        bytes32 k = key(token0, token1, fee);
        if (pools[k] == address(0)) {
            pools[k] = address(new MockV3Pool(sqrtPriceX96));
        }
        return pools[k]; // существующий пул НЕ переинициализируется
    }

    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    function mint(MintParams calldata p)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        // забираем средства как настоящий менеджер
        IERC20(p.token0).transferFrom(msg.sender, address(this), p.amount0Desired);
        IERC20(p.token1).transferFrom(msg.sender, address(this), p.amount1Desired);
        require(p.amount0Desired >= p.amount0Min, "amount0 < min");
        require(p.amount1Desired >= p.amount1Min, "amount1 < min");
        return (nextId++, 1, p.amount0Desired, p.amount1Desired);
    }
}

/// @dev Минимальный WETH9 для тестов миграции.
contract MockWETH {
    string public name = "Wrapped Ether";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function deposit() external payable { balanceOf[msg.sender] += msg.value; }

    function withdraw(uint256 amt) external {
        require(balanceOf[msg.sender] >= amt, "bal");
        balanceOf[msg.sender] -= amt;
        (bool ok, ) = msg.sender.call{value: amt}("");
        require(ok, "send");
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        require(balanceOf[msg.sender] >= a, "bal");
        balanceOf[msg.sender] -= a; balanceOf[to] += a;
        return true;
    }

    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        require(balanceOf[f] >= a, "bal");
        if (f != msg.sender) {
            require(allowance[f][msg.sender] >= a, "allow");
            allowance[f][msg.sender] -= a;
        }
        balanceOf[f] -= a; balanceOf[to] += a;
        return true;
    }

    receive() external payable { balanceOf[msg.sender] += msg.value; }
}

/// @dev Пул-заглушка, от имени которого вызывается migrate (у него есть creator()).
contract MockGraduatedPool {
    address public creator;
    constructor(address creator_) { creator = creator_; }

    function callMigrate(address migrator, address token, uint256 amount) external payable {
        (bool ok, bytes memory ret) = migrator.call{value: msg.value}(
            abi.encodeWithSignature("migrate(address,uint256)", token, amount)
        );
        if (!ok) {
            assembly { revert(add(ret, 32), mload(ret)) }
        }
    }

    receive() external payable {}
}
