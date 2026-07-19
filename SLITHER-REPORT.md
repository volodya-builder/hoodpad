# Slither static analysis report — hood launchpad

Compiler: solc 0.8.28, optimizer 200, evmVersion paris
Generated with slither 0.11.5 (Trail of Bits).

## Summary
No critical or high-severity vulnerabilities. Remaining flags are informational/benign (see notes).

## LaunchpadFactory
```
INFO:Detectors:
Detector: divide-before-multiply
BondingCurvePool.buy(uint256,address) (contracts/BondingCurvePool.sol#114-166) performs a multiplication on the result of a division:
	- tokensOut = (y * ethIn) / (x + ethIn) (contracts/BondingCurvePool.sol#128)
	- ethNeeded = (x * tokensOut + (y - tokensOut) - 1) / (y - tokensOut) (contracts/BondingCurvePool.sol#136)
BondingCurvePool.buy(uint256,address) (contracts/BondingCurvePool.sol#114-166) performs a multiplication on the result of a division:
	- ethNeeded = (x * tokensOut + (y - tokensOut) - 1) / (y - tokensOut) (contracts/BondingCurvePool.sol#136)
	- grossNeeded = (ethNeeded * 10_000 + (10_000 - feeBps) - 1) / (10_000 - feeBps) (contracts/BondingCurvePool.sol#138)
BondingCurvePool.sell(uint256,uint256) (contracts/BondingCurvePool.sol#169-196) performs a multiplication on the result of a division:
	- ethOutGross = (x * tokensIn) / (y + tokensIn) (contracts/BondingCurvePool.sol#179)
	- fee = (ethOutGross * feeBps) / 10_000 (contracts/BondingCurvePool.sol#182)
Reference: https://github.com/crytic/slither/wiki/Detector-Documentation#divide-before-multiply
INFO:Detectors:
Detector: uninitialized-local
BondingCurvePool.buy(uint256,address).refund (contracts/BondingCurvePool.sol#130) is a local variable never initialized
Reference: https://github.com/crytic/slither/wiki/Detector-Documentation#uninitialized-local-variables
INFO:Detectors:
Detector: unused-return
LaunchpadFactory.createToken(string,string,string,address) (contracts/LaunchpadFactory.sol#60-94) ignores return value by pool.buy{value: msg.value}(0,creator_) (contracts/LaunchpadFactory.sol#92)
Reference: https://github.com/crytic/slither/wiki/Detector-Documentation#unused-return
INFO:Detectors:
Detector: low-level-calls
Low level call in BondingCurvePool._sendEth(address,uint256) (contracts/BondingCurvePool.sol#246-250):
	- (ok,None) = to.call{value: amount}() (contracts/BondingCurvePool.sol#248)
Reference: https://github.com/crytic/slither/wiki/Detector-Documentation#low-level-calls
INFO:Detectors:
Detector: unindexed-event-address
Event LaunchpadFactory.ConfigUpdated(address,address,uint16,uint16) (contracts/LaunchpadFactory.sol#47) has address parameters but no indexed parameters
Reference: https://github.com/crytic/slither/wiki/Detector-Documentation#unindexed-event-address-parameters
```

## BondingCurvePool
```
INFO:Detectors:
Detector: divide-before-multiply
BondingCurvePool.buy(uint256,address) (contracts/BondingCurvePool.sol#114-166) performs a multiplication on the result of a division:
	- tokensOut = (y * ethIn) / (x + ethIn) (contracts/BondingCurvePool.sol#128)
	- ethNeeded = (x * tokensOut + (y - tokensOut) - 1) / (y - tokensOut) (contracts/BondingCurvePool.sol#136)
BondingCurvePool.buy(uint256,address) (contracts/BondingCurvePool.sol#114-166) performs a multiplication on the result of a division:
	- ethNeeded = (x * tokensOut + (y - tokensOut) - 1) / (y - tokensOut) (contracts/BondingCurvePool.sol#136)
	- grossNeeded = (ethNeeded * 10_000 + (10_000 - feeBps) - 1) / (10_000 - feeBps) (contracts/BondingCurvePool.sol#138)
BondingCurvePool.sell(uint256,uint256) (contracts/BondingCurvePool.sol#169-196) performs a multiplication on the result of a division:
	- ethOutGross = (x * tokensIn) / (y + tokensIn) (contracts/BondingCurvePool.sol#179)
	- fee = (ethOutGross * feeBps) / 10_000 (contracts/BondingCurvePool.sol#182)
Reference: https://github.com/crytic/slither/wiki/Detector-Documentation#divide-before-multiply
INFO:Detectors:
Detector: uninitialized-local
BondingCurvePool.buy(uint256,address).refund (contracts/BondingCurvePool.sol#130) is a local variable never initialized
Reference: https://github.com/crytic/slither/wiki/Detector-Documentation#uninitialized-local-variables
INFO:Detectors:
Detector: low-level-calls
Low level call in BondingCurvePool._sendEth(address,uint256) (contracts/BondingCurvePool.sol#246-250):
	- (ok,None) = to.call{value: amount}() (contracts/BondingCurvePool.sol#248)
Reference: https://github.com/crytic/slither/wiki/Detector-Documentation#low-level-calls
```

## BuybackTreasury
```
INFO:Detectors:
Detector: reentrancy-benign
Reentrancy in BuybackTreasury.buyback(address,uint256,uint256) (contracts/BuybackTreasury.sol#56-70):
	External calls:
	- tokensOut = IBuyablePool(pool).buy{value: ethAmount}(minTokensOut,address(this)) (contracts/BuybackTreasury.sol#66)
	State variables written after the call(s):
	- boughtOf[token] += tokensOut (contracts/BuybackTreasury.sol#68)
	- totalSpent += ethAmount (contracts/BuybackTreasury.sol#67)
Reference: https://github.com/crytic/slither/wiki/Detector-Documentation#reentrancy-vulnerabilities-3
```

## FeeSplitter
```
INFO:Detectors:
Detector: reentrancy-events
Reentrancy in FeeSplitter.receive() (contracts/FeeSplitter.sol#28-40):
	External calls:
	- (a,None) = team.call{value: toTeam}() (contracts/FeeSplitter.sol#32)
	- (b,None) = buyback.call{value: toBuyback}() (contracts/FeeSplitter.sol#36)
	Event emitted after the call(s):
	- Split(toTeam,toBuyback) (contracts/FeeSplitter.sol#39)
Reference: https://github.com/crytic/slither/wiki/Detector-Documentation#reentrancy-vulnerabilities-4
INFO:Detectors:
Detector: low-level-calls
Low level call in FeeSplitter.receive() (contracts/FeeSplitter.sol#28-40):
	- (a,None) = team.call{value: toTeam}() (contracts/FeeSplitter.sol#32)
	- (b,None) = buyback.call{value: toBuyback}() (contracts/FeeSplitter.sol#36)
Reference: https://github.com/crytic/slither/wiki/Detector-Documentation#low-level-calls
```

## BuybackVote
```
INFO:Detectors:
Detector: weak-prng
BuybackVote.epochEndsIn() (contracts/BuybackVote.sol#25-27) uses a weak PRNG: "EPOCH_LENGTH - (block.timestamp % EPOCH_LENGTH) (contracts/BuybackVote.sol#26)" 
Reference: https://github.com/crytic/slither/wiki/Detector-Documentation#weak-PRNG
```

## UniswapV3Migrator
```
INFO:Detectors:
Detector: unused-return
UniswapV3Migrator.migrate(address,uint256) (contracts/UniswapV3Migrator.sol#76-130) ignores return value by (positionId,None,used0,used1) = positionManager.mint(INonfungiblePositionManager.MintParams({token0:token0,token1:token1,fee:POOL_FEE,tickLower:TICK_LOWER,tickUpper:TICK_UPPER,amount0Desired:amount0,amount1Desired:amount1,amount0Min:0,amount1Min:0,recipient:address(this),deadline:block.timestamp})) (contracts/UniswapV3Migrator.sol#104-118)
Reference: https://github.com/crytic/slither/wiki/Detector-Documentation#unused-return
INFO:Detectors:
Detector: reentrancy-events
Reentrancy in UniswapV3Migrator.migrate(address,uint256) (contracts/UniswapV3Migrator.sol#76-130):
	External calls:
	- weth.deposit{value: ethAmount}() (contracts/UniswapV3Migrator.sol#81)
	- v3Pool = positionManager.createAndInitializePoolIfNecessary(token0,token1,POOL_FEE,sqrtPriceX96) (contracts/UniswapV3Migrator.sol#94-99)
	- (positionId,None,used0,used1) = positionManager.mint(INonfungiblePositionManager.MintParams({token0:token0,token1:token1,fee:POOL_FEE,tickLower:TICK_LOWER,tickUpper:TICK_UPPER,amount0Desired:amount0,amount1Desired:amount1,amount0Min:0,amount1Min:0,recipient:address(this),deadline:block.timestamp})) (contracts/UniswapV3Migrator.sol#104-118)
	- _refundDust(token,tokenAmount - used0,ethAmount - used1) (contracts/UniswapV3Migrator.sol#123-127)
		- weth.withdraw(leftoverWeth) (contracts/UniswapV3Migrator.sol#141)
		- (ok,None) = creator.call{value: leftoverWeth}() (contracts/UniswapV3Migrator.sol#142)
	- _refundDust(token,tokenAmount - used0,ethAmount - used0) (contracts/UniswapV3Migrator.sol#123-127)
		- weth.withdraw(leftoverWeth) (contracts/UniswapV3Migrator.sol#141)
		- (ok,None) = creator.call{value: leftoverWeth}() (contracts/UniswapV3Migrator.sol#142)
	- _refundDust(token,tokenAmount - used1,ethAmount - used1) (contracts/UniswapV3Migrator.sol#123-127)
		- weth.withdraw(leftoverWeth) (contracts/UniswapV3Migrator.sol#141)
		- (ok,None) = creator.call{value: leftoverWeth}() (contracts/UniswapV3Migrator.sol#142)
	- _refundDust(token,tokenAmount - used1,ethAmount - used0) (contracts/UniswapV3Migrator.sol#123-127)
		- weth.withdraw(leftoverWeth) (contracts/UniswapV3Migrator.sol#141)
		- (ok,None) = creator.call{value: leftoverWeth}() (contracts/UniswapV3Migrator.sol#142)
	External calls sending eth:
	- weth.deposit{value: ethAmount}() (contracts/UniswapV3Migrator.sol#81)
	- _refundDust(token,tokenAmount - used0,ethAmount - used1) (contracts/UniswapV3Migrator.sol#123-127)
		- (ok,None) = creator.call{value: leftoverWeth}() (contracts/UniswapV3Migrator.sol#142)
	- _refundDust(token,tokenAmount - used0,ethAmount - used0) (contracts/UniswapV3Migrator.sol#123-127)
		- (ok,None) = creator.call{value: leftoverWeth}() (contracts/UniswapV3Migrator.sol#142)
	- _refundDust(token,tokenAmount - used1,ethAmount - used1) (contracts/UniswapV3Migrator.sol#123-127)
		- (ok,None) = creator.call{value: leftoverWeth}() (contracts/UniswapV3Migrator.sol#142)
	- _refundDust(token,tokenAmount - used1,ethAmount - used0) (contracts/UniswapV3Migrator.sol#123-127)
		- (ok,None) = creator.call{value: leftoverWeth}() (contracts/UniswapV3Migrator.sol#142)
	Event emitted after the call(s):
	- LiquidityLocked(token,v3Pool,positionId,tokenAmount,ethAmount) (contracts/UniswapV3Migrator.sol#129)
Reference: https://github.com/crytic/slither/wiki/Detector-Documentation#reentrancy-vulnerabilities-4
INFO:Detectors:
Detector: timestamp
UniswapV3Migrator._refundDust(address,uint256,uint256) (contracts/UniswapV3Migrator.sol#134-145) uses timestamp for comparisons
	Dangerous comparisons:
```

## LaunchToken
```
```

