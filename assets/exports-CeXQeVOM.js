import{B as e,C as t,D as n,F as r,K as i,V as a,Y as o,_ as s,at as c,c as l,it as ee,l as u,m as te,nt as d,o as ne,q as re,r as f,st as p,x as m,y as h,z as ie}from"./ApiController-DuOQ9vCX.js";import{_ as ae,c as g,f as _,o as v,r as oe,s as se,t as ce}from"./exports-ClBc5snA.js";import{c as y,l as b,o as x,s as le,t as ue,u as S}from"./wui-text-_J_a5AnU.js";import{t as de}from"./MathUtil-B2UslVSw.js";import"./wui-button-BfVH6gS4.js";import"./wui-icon-CBKSno1O.js";import"./wui-icon-link-9-Al8620.js";import"./wui-image-jruU8U8Z.js";import"./wui-list-item-Yf06pSeK.js";import"./wui-loading-spinner-CNzaR7KI.js";import"./wui-wallet-switch-BJMeTtiY.js";import"./wui-separator-Crh1gOqL.js";import{t as C}from"./HelpersUtil-qZm_n459.js";import"./wui-shimmer-CB72AfIG.js";var fe=v`
  :host {
    position: relative;
  }

  button {
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: transparent;
    padding: ${({spacing:e})=>e[1]};
  }

  /* -- Colors --------------------------------------------------- */
  button[data-type='accent'] wui-icon {
    color: ${({tokens:e})=>e.core.iconAccentPrimary};
  }

  button[data-type='neutral'][data-variant='primary'] wui-icon {
    color: ${({tokens:e})=>e.theme.iconInverse};
  }

  button[data-type='neutral'][data-variant='secondary'] wui-icon {
    color: ${({tokens:e})=>e.theme.iconDefault};
  }

  button[data-type='success'] wui-icon {
    color: ${({tokens:e})=>e.core.iconSuccess};
  }

  button[data-type='error'] wui-icon {
    color: ${({tokens:e})=>e.core.iconError};
  }

  /* -- Sizes --------------------------------------------------- */
  button[data-size='xs'] {
    width: 16px;
    height: 16px;

    border-radius: ${({borderRadius:e})=>e[1]};
  }

  button[data-size='sm'] {
    width: 20px;
    height: 20px;
    border-radius: ${({borderRadius:e})=>e[1]};
  }

  button[data-size='md'] {
    width: 24px;
    height: 24px;
    border-radius: ${({borderRadius:e})=>e[2]};
  }

  button[data-size='lg'] {
    width: 28px;
    height: 28px;
    border-radius: ${({borderRadius:e})=>e[2]};
  }

  button[data-size='xs'] wui-icon {
    width: 8px;
    height: 8px;
  }

  button[data-size='sm'] wui-icon {
    width: 12px;
    height: 12px;
  }

  button[data-size='md'] wui-icon {
    width: 16px;
    height: 16px;
  }

  button[data-size='lg'] wui-icon {
    width: 20px;
    height: 20px;
  }

  /* -- Hover --------------------------------------------------- */
  @media (hover: hover) {
    button[data-type='accent']:hover:enabled {
      background-color: ${({tokens:e})=>e.core.foregroundAccent010};
    }

    button[data-variant='primary'][data-type='neutral']:hover:enabled {
      background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
    }

    button[data-variant='secondary'][data-type='neutral']:hover:enabled {
      background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
    }

    button[data-type='success']:hover:enabled {
      background-color: ${({tokens:e})=>e.core.backgroundSuccess};
    }

    button[data-type='error']:hover:enabled {
      background-color: ${({tokens:e})=>e.core.backgroundError};
    }
  }

  /* -- Focus --------------------------------------------------- */
  button:focus-visible {
    box-shadow: 0 0 0 4px ${({tokens:e})=>e.core.foregroundAccent020};
  }

  /* -- Properties --------------------------------------------------- */
  button[data-full-width='true'] {
    width: 100%;
  }

  :host([fullWidth]) {
    width: 100%;
  }

  button[disabled] {
    opacity: 0.5;
    cursor: not-allowed;
  }
`,w=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},T=class extends g{constructor(){super(...arguments),this.icon=`card`,this.variant=`primary`,this.type=`accent`,this.size=`md`,this.iconSize=void 0,this.fullWidth=!1,this.disabled=!1}render(){return _`<button
      data-variant=${this.variant}
      data-type=${this.type}
      data-size=${this.size}
      data-full-width=${this.fullWidth}
      ?disabled=${this.disabled}
    >
      <wui-icon color="inherit" name=${this.icon} size=${y(this.iconSize)}></wui-icon>
    </button>`}};T.styles=[oe,ce,fe],w([S()],T.prototype,`icon`,void 0),w([S()],T.prototype,`variant`,void 0),w([S()],T.prototype,`type`,void 0),w([S()],T.prototype,`size`,void 0),w([S()],T.prototype,`iconSize`,void 0),w([S({type:Boolean})],T.prototype,`fullWidth`,void 0),w([S({type:Boolean})],T.prototype,`disabled`,void 0),T=w([x(`wui-icon-button`)],T);var E={INVALID_PAYMENT_CONFIG:`INVALID_PAYMENT_CONFIG`,INVALID_RECIPIENT:`INVALID_RECIPIENT`,INVALID_ASSET:`INVALID_ASSET`,INVALID_AMOUNT:`INVALID_AMOUNT`,UNKNOWN_ERROR:`UNKNOWN_ERROR`,UNABLE_TO_INITIATE_PAYMENT:`UNABLE_TO_INITIATE_PAYMENT`,INVALID_CHAIN_NAMESPACE:`INVALID_CHAIN_NAMESPACE`,GENERIC_PAYMENT_ERROR:`GENERIC_PAYMENT_ERROR`,UNABLE_TO_GET_EXCHANGES:`UNABLE_TO_GET_EXCHANGES`,ASSET_NOT_SUPPORTED:`ASSET_NOT_SUPPORTED`,UNABLE_TO_GET_PAY_URL:`UNABLE_TO_GET_PAY_URL`,UNABLE_TO_GET_BUY_STATUS:`UNABLE_TO_GET_BUY_STATUS`,UNABLE_TO_GET_TOKEN_BALANCES:`UNABLE_TO_GET_TOKEN_BALANCES`,UNABLE_TO_GET_QUOTE:`UNABLE_TO_GET_QUOTE`,UNABLE_TO_GET_QUOTE_STATUS:`UNABLE_TO_GET_QUOTE_STATUS`,INVALID_RECIPIENT_ADDRESS_FOR_ASSET:`INVALID_RECIPIENT_ADDRESS_FOR_ASSET`},D={[E.INVALID_PAYMENT_CONFIG]:`Invalid payment configuration`,[E.INVALID_RECIPIENT]:`Invalid recipient address`,[E.INVALID_ASSET]:`Invalid asset specified`,[E.INVALID_AMOUNT]:`Invalid payment amount`,[E.INVALID_RECIPIENT_ADDRESS_FOR_ASSET]:`Invalid recipient address for the asset selected`,[E.UNKNOWN_ERROR]:`Unknown payment error occurred`,[E.UNABLE_TO_INITIATE_PAYMENT]:`Unable to initiate payment`,[E.INVALID_CHAIN_NAMESPACE]:`Invalid chain namespace`,[E.GENERIC_PAYMENT_ERROR]:`Unable to process payment`,[E.UNABLE_TO_GET_EXCHANGES]:`Unable to get exchanges`,[E.ASSET_NOT_SUPPORTED]:`Asset not supported by the selected exchange`,[E.UNABLE_TO_GET_PAY_URL]:`Unable to get payment URL`,[E.UNABLE_TO_GET_BUY_STATUS]:`Unable to get buy status`,[E.UNABLE_TO_GET_TOKEN_BALANCES]:`Unable to get token balances`,[E.UNABLE_TO_GET_QUOTE]:`Unable to get quote. Please choose a different token`,[E.UNABLE_TO_GET_QUOTE_STATUS]:`Unable to get quote status`},O=class e extends Error{get message(){return D[this.code]}constructor(t,n){super(D[t]),this.name=`AppKitPayError`,this.code=t,this.details=n,Error.captureStackTrace&&Error.captureStackTrace(this,e)}},pe=`https://rpc.walletconnect.org/v1/json-rpc`,me=`reown_test`;function he(){let{chainNamespace:e}=d.parseCaipNetworkId(L.state.paymentAsset.network);if(!a.isAddress(L.state.recipient,e))throw new O(E.INVALID_RECIPIENT_ADDRESS_FOR_ASSET,`Provide valid recipient address for namespace "${e}"`)}async function ge(e,t,n){if(t!==p.CHAIN.EVM)throw new O(E.INVALID_CHAIN_NAMESPACE);if(!n.fromAddress)throw new O(E.INVALID_PAYMENT_CONFIG,`fromAddress is required for native EVM payments.`);let r=typeof n.amount==`string`?parseFloat(n.amount):n.amount;if(isNaN(r))throw new O(E.INVALID_PAYMENT_CONFIG);let i=e.metadata?.decimals??18,a=u.parseUnits(r.toString(),i);if(typeof a!=`bigint`)throw new O(E.GENERIC_PAYMENT_ERROR);return await u.sendTransaction({chainNamespace:t,to:n.recipient,address:n.fromAddress,value:a,data:`0x`})??void 0}async function _e(e,t){if(!t.fromAddress)throw new O(E.INVALID_PAYMENT_CONFIG,`fromAddress is required for ERC20 EVM payments.`);let n=e.asset,r=t.recipient,i=Number(e.metadata.decimals),a=u.parseUnits(t.amount.toString(),i);if(a===void 0)throw new O(E.GENERIC_PAYMENT_ERROR);return await u.writeContract({fromAddress:t.fromAddress,tokenAddress:n,args:[r,a],method:`transfer`,abi:ee.getERC20Abi(n),chainNamespace:p.CHAIN.EVM})??void 0}async function ve(e,t){if(e!==p.CHAIN.SOLANA)throw new O(E.INVALID_CHAIN_NAMESPACE);if(!t.fromAddress)throw new O(E.INVALID_PAYMENT_CONFIG,`fromAddress is required for Solana payments.`);let n=typeof t.amount==`string`?parseFloat(t.amount):t.amount;if(isNaN(n)||n<=0)throw new O(E.INVALID_PAYMENT_CONFIG,`Invalid payment amount.`);try{if(!ne.getProvider(e))throw new O(E.GENERIC_PAYMENT_ERROR,`No Solana provider available.`);let r=await u.sendTransaction({chainNamespace:p.CHAIN.SOLANA,to:t.recipient,value:n,tokenMint:t.tokenMint});if(!r)throw new O(E.GENERIC_PAYMENT_ERROR,`Transaction failed.`);return r}catch(e){throw e instanceof O?e:new O(E.GENERIC_PAYMENT_ERROR,`Solana payment failed: ${e}`)}}async function ye({sourceToken:e,toToken:t,amount:n,recipient:r}){let i=u.parseUnits(n,e.metadata.decimals),a=u.parseUnits(n,t.metadata.decimals);return Promise.resolve({type:Re,origin:{amount:i?.toString()??`0`,currency:e},destination:{amount:a?.toString()??`0`,currency:t},fees:[{id:`service`,label:`Service Fee`,amount:`0`,currency:t}],steps:[{requestId:Re,type:`deposit`,deposit:{amount:i?.toString()??`0`,currency:e.asset,receiver:r}}],timeInSeconds:6})}function k(e){if(!e)return null;let t=e.steps[0];return!t||t.type!==`deposit`?null:t}function A(e,t=0){if(!e)return[];let n=e.steps.filter(e=>e.type===ze),r=n.filter((e,n)=>n+1>t);return n.length>0&&n.length<3?r:[]}var j=new e({baseUrl:a.getApiUrl(),clientId:null}),be=class extends Error{};function xe(){return`${pe}?projectId=${ie.getSnapshot().projectId}`}function M(){let{projectId:e,sdkType:t,sdkVersion:n}=ie.state;return{projectId:e,st:t||`appkit`,sv:n||`html-wagmi-4.2.2`}}async function Se(e,t){let n=xe(),{sdkType:r,sdkVersion:i,projectId:a}=ie.getSnapshot(),o={jsonrpc:`2.0`,id:1,method:e,params:{...t||{},st:r,sv:i,projectId:a}},s=await(await fetch(n,{method:`POST`,body:JSON.stringify(o),headers:{"Content-Type":`application/json`}})).json();if(s.error)throw new be(s.error.message);return s}async function Ce(e){return(await Se(`reown_getExchanges`,e)).result}async function we(e){return(await Se(`reown_getExchangePayUrl`,e)).result}async function Te(e){return(await Se(`reown_getExchangeBuyStatus`,e)).result}async function Ee(e){let t=c.bigNumber(e.amount).times(10**e.toToken.metadata.decimals).toString(),{chainId:n,chainNamespace:r}=d.parseCaipNetworkId(e.sourceToken.network),{chainId:i,chainNamespace:a}=d.parseCaipNetworkId(e.toToken.network),o=e.sourceToken.asset===`native`?te(r):e.sourceToken.asset,s=e.toToken.asset===`native`?te(a):e.toToken.asset;return await j.post({path:`/appkit/v1/transfers/quote`,body:{user:e.address,originChainId:n.toString(),originCurrency:o,destinationChainId:i.toString(),destinationCurrency:s,recipient:e.recipient,amount:t},params:M()})}async function De(e){let t=C.isLowerCaseMatch(e.sourceToken.network,e.toToken.network),n=C.isLowerCaseMatch(e.sourceToken.asset,e.toToken.asset);return t&&n?ye(e):Ee(e)}async function Oe(e){return await j.get({path:`/appkit/v1/transfers/status`,params:{requestId:e.requestId,...M()}})}async function ke(e){return await j.get({path:`/appkit/v1/transfers/assets/exchanges/${e}`,params:M()})}var Ae=[`eip155`,`solana`],je={eip155:{native:{assetNamespace:`slip44`,assetReference:`60`},defaultTokenNamespace:`erc20`},solana:{native:{assetNamespace:`slip44`,assetReference:`501`},defaultTokenNamespace:`token`}},Me={56:`714`,204:`714`};function N(e,t){let{chainNamespace:n,chainId:r}=d.parseCaipNetworkId(e),i=je[n];if(!i)throw Error(`Unsupported chain namespace for CAIP-19 formatting: ${n}`);let a=i.native.assetNamespace,o=i.native.assetReference;return t===`native`?n===`eip155`&&Me[r]&&(o=Me[r]):(a=i.defaultTokenNamespace,o=t),`${`${n}:${r}`}/${a}:${o}`}function Ne(e){let{chainNamespace:t}=d.parseCaipNetworkId(e);return Ae.includes(t)}function Pe(e){let t=f.getAllRequestedCaipNetworks().find(t=>t.caipNetworkId===e.chainId),n=e.address;if(!t)throw Error(`Target network not found for balance chainId "${e.chainId}"`);if(C.isLowerCaseMatch(e.symbol,t.nativeCurrency.symbol))n=`native`;else if(a.isCaipAddress(n)){let{address:e}=d.parseCaipAddress(n);n=e}else if(!n)throw Error(`Balance address not found for balance symbol "${e.symbol}"`);return{network:t.caipNetworkId,asset:n,metadata:{name:e.name,symbol:e.symbol,decimals:Number(e.quantity.decimals),logoURI:e.iconUrl},amount:e.quantity.numeric}}function Fe(e){return{chainId:e.network,address:`${e.network}:${e.asset}`,symbol:e.metadata.symbol,name:e.metadata.name,iconUrl:e.metadata.logoURI||``,price:0,quantity:{numeric:`0`,decimals:e.metadata.decimals.toString()}}}function P(e){let t=c.bigNumber(e,{safe:!0});return t.lt(.001)?`<0.001`:t.round(4).toString()}function Ie(e){let t=f.getAllRequestedCaipNetworks().find(t=>t.caipNetworkId===e.network);return t?!!t.testnet:!1}var Le=0,F=`unknown`,Re=`direct-transfer`,ze=`transaction`,I=re({paymentAsset:{network:`eip155:1`,asset:`0x0`,metadata:{name:`0x0`,symbol:`0x0`,decimals:0}},recipient:`0x0`,amount:0,isConfigured:!1,error:null,isPaymentInProgress:!1,exchanges:[],isLoading:!1,openInNewTab:!0,redirectUrl:void 0,payWithExchange:void 0,currentPayment:void 0,analyticsSet:!1,paymentId:void 0,choice:`pay`,tokenBalances:{[p.CHAIN.EVM]:[],[p.CHAIN.SOLANA]:[]},isFetchingTokenBalances:!1,selectedPaymentAsset:null,quote:void 0,quoteStatus:`waiting`,quoteError:null,isFetchingQuote:!1,selectedExchange:void 0,exchangeUrlForQuote:void 0,requestId:void 0}),L={state:I,subscribe(e){return o(I,()=>e(I))},subscribeKey(e,t){return i(I,e,t)},async handleOpenPay(e){this.resetState(),this.setPaymentConfig(e),this.initializeAnalytics(),he(),await this.prepareTokenLogo(),I.isConfigured=!0,m.sendEvent({type:`track`,event:`PAY_MODAL_OPEN`,properties:{exchanges:I.exchanges,configuration:{network:I.paymentAsset.network,asset:I.paymentAsset.asset,recipient:I.recipient,amount:I.amount}}}),await h.open({view:`Pay`})},resetState(){I.paymentAsset={network:`eip155:1`,asset:`0x0`,metadata:{name:`0x0`,symbol:`0x0`,decimals:0}},I.recipient=`0x0`,I.amount=0,I.isConfigured=!1,I.error=null,I.isPaymentInProgress=!1,I.isLoading=!1,I.currentPayment=void 0,I.selectedExchange=void 0,I.exchangeUrlForQuote=void 0,I.requestId=void 0},resetQuoteState(){I.quote=void 0,I.quoteStatus=`waiting`,I.quoteError=null,I.isFetchingQuote=!1,I.requestId=void 0},setPaymentConfig(e){if(!e.paymentAsset)throw new O(E.INVALID_PAYMENT_CONFIG);try{I.choice=e.choice??`pay`,I.paymentAsset=e.paymentAsset,I.recipient=e.recipient,I.amount=e.amount,I.openInNewTab=e.openInNewTab??!0,I.redirectUrl=e.redirectUrl,I.payWithExchange=e.payWithExchange,I.error=null}catch(e){throw new O(E.INVALID_PAYMENT_CONFIG,e.message)}},setSelectedPaymentAsset(e){I.selectedPaymentAsset=e},setSelectedExchange(e){I.selectedExchange=e},setRequestId(e){I.requestId=e},setPaymentInProgress(e){I.isPaymentInProgress=e},getPaymentAsset(){return I.paymentAsset},getExchanges(){return I.exchanges},async fetchExchanges(){try{I.isLoading=!0,I.exchanges=(await Ce({page:Le})).exchanges.slice(0,2)}catch{throw n.showError(D.UNABLE_TO_GET_EXCHANGES),new O(E.UNABLE_TO_GET_EXCHANGES)}finally{I.isLoading=!1}},async getAvailableExchanges(e){try{let t=e?.asset&&e?.network?N(e.network,e.asset):void 0;return await Ce({page:e?.page??Le,asset:t,amount:e?.amount?.toString()})}catch{throw new O(E.UNABLE_TO_GET_EXCHANGES)}},async getPayUrl(e,t,n=!1){try{let r=Number(t.amount),i=await we({exchangeId:e,asset:N(t.network,t.asset),amount:r.toString(),recipient:`${t.network}:${t.recipient}`});return m.sendEvent({type:`track`,event:`PAY_EXCHANGE_SELECTED`,properties:{source:`pay`,exchange:{id:e},configuration:{network:t.network,asset:t.asset,recipient:t.recipient,amount:r},currentPayment:{type:`exchange`,exchangeId:e},headless:n}}),n&&(this.initiatePayment(),m.sendEvent({type:`track`,event:`PAY_INITIATED`,properties:{source:`pay`,paymentId:I.paymentId||F,configuration:{network:t.network,asset:t.asset,recipient:t.recipient,amount:r},currentPayment:{type:`exchange`,exchangeId:e}}})),i}catch(e){throw e instanceof Error&&e.message.includes(`is not supported`)?new O(E.ASSET_NOT_SUPPORTED):Error(e.message)}},async generateExchangeUrlForQuote({exchangeId:e,paymentAsset:t,amount:n,recipient:r}){let i=await we({exchangeId:e,asset:N(t.network,t.asset),amount:n.toString(),recipient:r});I.exchangeSessionId=i.sessionId,I.exchangeUrlForQuote=i.url},async openPayUrl(e,t,n=!1){try{let r=await this.getPayUrl(e.exchangeId,t,n);if(!r)throw new O(E.UNABLE_TO_GET_PAY_URL);let i=e.openInNewTab??!0?`_blank`:`_self`;return a.openHref(r.url,i),r}catch(e){throw e instanceof O?I.error=e.message:I.error=D.GENERIC_PAYMENT_ERROR,new O(E.UNABLE_TO_GET_PAY_URL)}},async onTransfer({chainNamespace:e,fromAddress:t,toAddress:r,amount:i,paymentAsset:a}){if(I.currentPayment={type:`wallet`,status:`IN_PROGRESS`},!I.isPaymentInProgress)try{this.initiatePayment();let n=f.getAllRequestedCaipNetworks().find(e=>e.caipNetworkId===a.network);if(!n)throw Error(`Target network not found`);let o=f.state.activeCaipNetwork;switch(C.isLowerCaseMatch(o?.caipNetworkId,n.caipNetworkId)||await f.switchActiveNetwork(n),e){case p.CHAIN.EVM:a.asset===`native`&&(I.currentPayment.result=await ge(a,e,{recipient:r,amount:i,fromAddress:t})),a.asset.startsWith(`0x`)&&(I.currentPayment.result=await _e(a,{recipient:r,amount:i,fromAddress:t})),I.currentPayment.status=`SUCCESS`;break;case p.CHAIN.SOLANA:I.currentPayment.result=await ve(e,{recipient:r,amount:i,fromAddress:t,tokenMint:a.asset===`native`?void 0:a.asset}),I.currentPayment.status=`SUCCESS`;break;default:throw new O(E.INVALID_CHAIN_NAMESPACE)}}catch(e){throw e instanceof O?I.error=e.message:I.error=D.GENERIC_PAYMENT_ERROR,I.currentPayment.status=`FAILED`,n.showError(I.error),e}finally{I.isPaymentInProgress=!1}},async onSendTransaction(e){try{let{namespace:t,transactionStep:n}=e;L.initiatePayment();let r=f.getAllRequestedCaipNetworks().find(e=>e.caipNetworkId===I.paymentAsset?.network);if(!r)throw Error(`Target network not found`);let i=f.state.activeCaipNetwork;if(C.isLowerCaseMatch(i?.caipNetworkId,r.caipNetworkId)||await f.switchActiveNetwork(r),t===p.CHAIN.EVM){let{from:e,to:r,data:i,value:a}=n.transaction;await u.sendTransaction({address:e,to:r,data:i,value:BigInt(a),chainNamespace:t})}else if(t===p.CHAIN.SOLANA){let{instructions:e}=n.transaction;await u.writeSolanaTransaction({instructions:e})}}catch(e){throw e instanceof O?I.error=e.message:I.error=D.GENERIC_PAYMENT_ERROR,n.showError(I.error),e}finally{I.isPaymentInProgress=!1}},getExchangeById(e){return I.exchanges.find(t=>t.id===e)},validatePayConfig(e){let{paymentAsset:t,recipient:n,amount:r}=e;if(!t)throw new O(E.INVALID_PAYMENT_CONFIG);if(!n)throw new O(E.INVALID_RECIPIENT);if(!t.asset)throw new O(E.INVALID_ASSET);if(r==null||r<=0)throw new O(E.INVALID_AMOUNT)},async handlePayWithExchange(e){try{I.currentPayment={type:`exchange`,exchangeId:e};let{network:t,asset:n}=I.paymentAsset,r={network:t,asset:n,amount:I.amount,recipient:I.recipient},i=await this.getPayUrl(e,r);if(!i)throw new O(E.UNABLE_TO_INITIATE_PAYMENT);return I.currentPayment.sessionId=i.sessionId,I.currentPayment.status=`IN_PROGRESS`,I.currentPayment.exchangeId=e,this.initiatePayment(),{url:i.url,openInNewTab:I.openInNewTab}}catch(e){return e instanceof O?I.error=e.message:I.error=D.GENERIC_PAYMENT_ERROR,I.isPaymentInProgress=!1,n.showError(I.error),null}},async getBuyStatus(e,t){try{let n=await Te({sessionId:t,exchangeId:e});return(n.status===`SUCCESS`||n.status===`FAILED`)&&m.sendEvent({type:`track`,event:n.status===`SUCCESS`?`PAY_SUCCESS`:`PAY_ERROR`,properties:{message:n.status===`FAILED`?a.parseError(I.error):void 0,source:`pay`,paymentId:I.paymentId||F,configuration:{network:I.paymentAsset.network,asset:I.paymentAsset.asset,recipient:I.recipient,amount:I.amount},currentPayment:{type:`exchange`,exchangeId:I.currentPayment?.exchangeId,sessionId:I.currentPayment?.sessionId,result:n.txHash}}}),n}catch{throw new O(E.UNABLE_TO_GET_BUY_STATUS)}},async fetchTokensFromEOA({caipAddress:e,caipNetwork:t,namespace:n}){if(!e)return[];let{address:r}=d.parseCaipAddress(e),i=t;return n===p.CHAIN.EVM&&(i=void 0),await l.getMyTokensWithBalance({address:r,caipNetwork:i})},async fetchTokensFromExchange(){if(!I.selectedExchange)return[];let e=await ke(I.selectedExchange.id),t=Object.values(e.assets).flat();return await Promise.all(t.map(async e=>{let t=Fe(e),{chainNamespace:n}=d.parseCaipNetworkId(t.chainId),i=t.address;if(a.isCaipAddress(i)){let{address:e}=d.parseCaipAddress(i);i=e}return t.iconUrl=await r.getImageByToken(i??``,n).catch(()=>void 0)??``,t}))},async fetchTokens({caipAddress:e,caipNetwork:t,namespace:r}){try{I.isFetchingTokenBalances=!0;let n=await(I.selectedExchange?this.fetchTokensFromExchange():this.fetchTokensFromEOA({caipAddress:e,caipNetwork:t,namespace:r}));I.tokenBalances={...I.tokenBalances,[r]:n}}catch(e){let t=e instanceof Error?e.message:`Unable to get token balances`;n.showError(t)}finally{I.isFetchingTokenBalances=!1}},async fetchQuote({amount:e,address:t,sourceToken:r,toToken:i,recipient:a}){try{L.resetQuoteState(),I.isFetchingQuote=!0;let n=await De({amount:e,address:I.selectedExchange?void 0:t,sourceToken:r,toToken:i,recipient:a});if(I.selectedExchange){let e=k(n);if(e){let t=`${r.network}:${e.deposit.receiver}`,n=c.formatNumber(e.deposit.amount,{decimals:r.metadata.decimals??0,round:8});await L.generateExchangeUrlForQuote({exchangeId:I.selectedExchange.id,paymentAsset:r,amount:n.toString(),recipient:t})}}I.quote=n}catch(e){let t=D.UNABLE_TO_GET_QUOTE;if(e instanceof Error&&e.cause&&e.cause instanceof Response)try{let n=await e.cause.json();n.error&&typeof n.error==`string`&&(t=n.error)}catch{}throw I.quoteError=t,n.showError(t),new O(E.UNABLE_TO_GET_QUOTE)}finally{I.isFetchingQuote=!1}},async fetchQuoteStatus({requestId:e}){try{if(e===`direct-transfer`){let e=I.selectedExchange,t=I.exchangeSessionId;if(e&&t){switch((await this.getBuyStatus(e.id,t)).status){case`IN_PROGRESS`:I.quoteStatus=`waiting`;break;case`SUCCESS`:I.quoteStatus=`success`,I.isPaymentInProgress=!1;break;case`FAILED`:I.quoteStatus=`failure`,I.isPaymentInProgress=!1;break;case`UNKNOWN`:I.quoteStatus=`waiting`;break;default:I.quoteStatus=`waiting`;break}return}I.quoteStatus=`success`;return}let{status:t}=await Oe({requestId:e});I.quoteStatus=t}catch{throw I.quoteStatus=`failure`,new O(E.UNABLE_TO_GET_QUOTE_STATUS)}},initiatePayment(){I.isPaymentInProgress=!0,I.paymentId=crypto.randomUUID()},initializeAnalytics(){I.analyticsSet||(I.analyticsSet=!0,this.subscribeKey(`isPaymentInProgress`,e=>{if(I.currentPayment?.status&&I.currentPayment.status!==`UNKNOWN`){let e={IN_PROGRESS:`PAY_INITIATED`,SUCCESS:`PAY_SUCCESS`,FAILED:`PAY_ERROR`}[I.currentPayment.status];m.sendEvent({type:`track`,event:e,properties:{message:I.currentPayment.status===`FAILED`?a.parseError(I.error):void 0,source:`pay`,paymentId:I.paymentId||F,configuration:{network:I.paymentAsset.network,asset:I.paymentAsset.asset,recipient:I.recipient,amount:I.amount},currentPayment:{type:I.currentPayment.type,exchangeId:I.currentPayment.exchangeId,sessionId:I.currentPayment.sessionId,result:I.currentPayment.result}}})}}))},async prepareTokenLogo(){if(!I.paymentAsset.metadata.logoURI)try{let{chainNamespace:e}=d.parseCaipNetworkId(I.paymentAsset.network),t=await r.getImageByToken(I.paymentAsset.asset,e);I.paymentAsset.metadata.logoURI=t}catch{}}},Be=v`
  wui-separator {
    margin: var(--apkt-spacing-3) calc(var(--apkt-spacing-3) * -1) var(--apkt-spacing-2)
      calc(var(--apkt-spacing-3) * -1);
    width: calc(100% + var(--apkt-spacing-3) * 2);
  }

  .token-display {
    padding: var(--apkt-spacing-3) var(--apkt-spacing-3);
    border-radius: var(--apkt-borderRadius-5);
    background-color: var(--apkt-tokens-theme-backgroundPrimary);
    margin-top: var(--apkt-spacing-3);
    margin-bottom: var(--apkt-spacing-3);
  }

  .token-display wui-text {
    text-transform: none;
  }

  wui-loading-spinner {
    padding: var(--apkt-spacing-2);
  }

  .left-image-container {
    position: relative;
    justify-content: center;
    align-items: center;
  }

  .token-image {
    border-radius: ${({borderRadius:e})=>e.round};
    width: 40px;
    height: 40px;
  }

  .chain-image {
    position: absolute;
    width: 20px;
    height: 20px;
    bottom: -3px;
    right: -5px;
    border-radius: ${({borderRadius:e})=>e.round};
    border: 2px solid ${({tokens:e})=>e.theme.backgroundPrimary};
  }

  .payment-methods-container {
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    border-top-right-radius: ${({borderRadius:e})=>e[8]};
    border-top-left-radius: ${({borderRadius:e})=>e[8]};
  }
`,R=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},z=class extends g{constructor(){super(),this.unsubscribe=[],this.amount=L.state.amount,this.namespace=void 0,this.paymentAsset=L.state.paymentAsset,this.activeConnectorIds=s.state.activeConnectorIds,this.caipAddress=void 0,this.exchanges=L.state.exchanges,this.isLoading=L.state.isLoading,this.initializeNamespace(),this.unsubscribe.push(L.subscribeKey(`amount`,e=>this.amount=e)),this.unsubscribe.push(s.subscribeKey(`activeConnectorIds`,e=>this.activeConnectorIds=e)),this.unsubscribe.push(L.subscribeKey(`exchanges`,e=>this.exchanges=e)),this.unsubscribe.push(L.subscribeKey(`isLoading`,e=>this.isLoading=e)),L.fetchExchanges(),L.setSelectedExchange(void 0)}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){return _`
      <wui-flex flexDirection="column">
        ${this.paymentDetailsTemplate()} ${this.paymentMethodsTemplate()}
      </wui-flex>
    `}paymentMethodsTemplate(){return _`
      <wui-flex flexDirection="column" padding="3" gap="2" class="payment-methods-container">
        ${this.payWithWalletTemplate()} ${this.templateSeparator()}
        ${this.templateExchangeOptions()}
      </wui-flex>
    `}initializeNamespace(){let e=f.state.activeChain;this.namespace=e,this.caipAddress=f.getAccountData(e)?.caipAddress,this.unsubscribe.push(f.subscribeChainProp(`accountState`,e=>{this.caipAddress=e?.caipAddress},e))}paymentDetailsTemplate(){let e=f.getAllRequestedCaipNetworks().find(e=>e.caipNetworkId===this.paymentAsset.network);return _`
      <wui-flex
        alignItems="center"
        justifyContent="space-between"
        .padding=${[`6`,`8`,`6`,`8`]}
        gap="2"
      >
        <wui-flex alignItems="center" gap="1">
          <wui-text variant="h1-regular" color="primary">
            ${P(this.amount||`0`)}
          </wui-text>

          <wui-flex flexDirection="column">
            <wui-text variant="h6-regular" color="secondary">
              ${this.paymentAsset.metadata.symbol||`Unknown`}
            </wui-text>
            <wui-text variant="md-medium" color="secondary"
              >on ${e?.name||`Unknown`}</wui-text
            >
          </wui-flex>
        </wui-flex>

        <wui-flex class="left-image-container">
          <wui-image
            src=${y(this.paymentAsset.metadata.logoURI)}
            class="token-image"
          ></wui-image>
          <wui-image
            src=${y(r.getNetworkImage(e))}
            class="chain-image"
          ></wui-image>
        </wui-flex>
      </wui-flex>
    `}payWithWalletTemplate(){return Ne(this.paymentAsset.network)?this.caipAddress?this.connectedWalletTemplate():this.disconnectedWalletTemplate():_``}connectedWalletTemplate(){let{name:e,image:t}=this.getWalletProperties({namespace:this.namespace});return _`
      <wui-flex flexDirection="column" gap="3">
        <wui-list-item
          type="secondary"
          boxColor="foregroundSecondary"
          @click=${this.onWalletPayment}
          .boxed=${!1}
          ?chevron=${!0}
          ?fullSize=${!1}
          ?rounded=${!0}
          data-testid="wallet-payment-option"
          imageSrc=${y(t)}
          imageSize="3xl"
        >
          <wui-text variant="lg-regular" color="primary">Pay with ${e}</wui-text>
        </wui-list-item>

        <wui-list-item
          type="secondary"
          icon="power"
          iconColor="error"
          @click=${this.onDisconnect}
          data-testid="disconnect-button"
          ?chevron=${!1}
          boxColor="foregroundSecondary"
        >
          <wui-text variant="lg-regular" color="secondary">Disconnect</wui-text>
        </wui-list-item>
      </wui-flex>
    `}disconnectedWalletTemplate(){return _`<wui-list-item
      type="secondary"
      boxColor="foregroundSecondary"
      variant="icon"
      iconColor="default"
      iconVariant="overlay"
      icon="wallet"
      @click=${this.onWalletPayment}
      ?chevron=${!0}
      data-testid="wallet-payment-option"
    >
      <wui-text variant="lg-regular" color="primary">Pay with wallet</wui-text>
    </wui-list-item>`}templateExchangeOptions(){if(this.isLoading)return _`<wui-flex justifyContent="center" alignItems="center">
        <wui-loading-spinner size="md"></wui-loading-spinner>
      </wui-flex>`;let e=this.exchanges.filter(e=>Ie(this.paymentAsset)?e.id===me:e.id!==me);return e.length===0?_`<wui-flex justifyContent="center" alignItems="center">
        <wui-text variant="md-medium" color="primary">No exchanges available</wui-text>
      </wui-flex>`:e.map(e=>_`
        <wui-list-item
          type="secondary"
          boxColor="foregroundSecondary"
          @click=${()=>this.onExchangePayment(e)}
          data-testid="exchange-option-${e.id}"
          ?chevron=${!0}
          imageSrc=${y(e.imageUrl)}
        >
          <wui-text flexGrow="1" variant="lg-regular" color="primary">
            Pay with ${e.name}
          </wui-text>
        </wui-list-item>
      `)}templateSeparator(){return _`<wui-separator text="or" bgColor="secondary"></wui-separator>`}async onWalletPayment(){if(!this.namespace)throw Error(`Namespace not found`);this.caipAddress?t.push(`PayQuote`):(await s.connect(),await h.open({view:`PayQuote`}))}onExchangePayment(e){L.setSelectedExchange(e),t.push(`PayQuote`)}async onDisconnect(){try{await u.disconnect(),await h.open({view:`Pay`})}catch{console.error(`Failed to disconnect`),n.showError(`Failed to disconnect`)}}getWalletProperties({namespace:e}){if(!e)return{name:void 0,image:void 0};let t=this.activeConnectorIds[e];if(!t)return{name:void 0,image:void 0};let n=s.getConnector({id:t,namespace:e});if(!n)return{name:void 0,image:void 0};let i=r.getConnectorImage(n);return{name:n.name,image:i}}};z.styles=Be,R([b()],z.prototype,`amount`,void 0),R([b()],z.prototype,`namespace`,void 0),R([b()],z.prototype,`paymentAsset`,void 0),R([b()],z.prototype,`activeConnectorIds`,void 0),R([b()],z.prototype,`caipAddress`,void 0),R([b()],z.prototype,`exchanges`,void 0),R([b()],z.prototype,`isLoading`,void 0),z=R([x(`w3m-pay-view`)],z);var Ve=v`
  :host {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .pulse-container {
    position: relative;
    width: var(--pulse-size);
    height: var(--pulse-size);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .pulse-rings {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .pulse-ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 2px solid var(--pulse-color);
    opacity: 0;
    animation: pulse var(--pulse-duration, 2s) ease-out infinite;
  }

  .pulse-content {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  @keyframes pulse {
    0% {
      transform: scale(0.5);
      opacity: var(--pulse-opacity, 0.3);
    }
    50% {
      opacity: calc(var(--pulse-opacity, 0.3) * 0.5);
    }
    100% {
      transform: scale(1.2);
      opacity: 0;
    }
  }
`,B=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},He=3,Ue=2,We=.3,Ge=`200px`,Ke={"accent-primary":se.tokens.core.backgroundAccentPrimary},V=class extends g{constructor(){super(...arguments),this.rings=He,this.duration=Ue,this.opacity=We,this.size=Ge,this.variant=`accent-primary`}render(){let e=Ke[this.variant];return this.style.cssText=`
      --pulse-size: ${this.size};
      --pulse-duration: ${this.duration}s;
      --pulse-color: ${e};
      --pulse-opacity: ${this.opacity};
    `,_`
      <div class="pulse-container">
        <div class="pulse-rings">${Array.from({length:this.rings},(e,t)=>this.renderRing(t,this.rings))}</div>
        <div class="pulse-content">
          <slot></slot>
        </div>
      </div>
    `}renderRing(e,t){return _`<div class="pulse-ring" style=${`animation-delay: ${e/t*this.duration}s;`}></div>`}};V.styles=[oe,Ve],B([S({type:Number})],V.prototype,`rings`,void 0),B([S({type:Number})],V.prototype,`duration`,void 0),B([S({type:Number})],V.prototype,`opacity`,void 0),B([S()],V.prototype,`size`,void 0),B([S()],V.prototype,`variant`,void 0),V=B([x(`wui-pulse`)],V);var qe=[{id:`received`,title:`Receiving funds`,icon:`dollar`},{id:`processing`,title:`Swapping asset`,icon:`recycleHorizontal`},{id:`sending`,title:`Sending asset to the recipient address`,icon:`send`}],Je=[`success`,`submitted`,`failure`,`timeout`,`refund`],Ye=v`
  :host {
    display: block;
    height: 100%;
    width: 100%;
  }

  wui-image {
    border-radius: ${({borderRadius:e})=>e.round};
  }

  .token-badge-container {
    position: absolute;
    bottom: 6px;
    left: 50%;
    transform: translateX(-50%);
    border-radius: ${({borderRadius:e})=>e[4]};
    z-index: 3;
    min-width: 105px;
  }

  .token-badge-container.loading {
    background-color: ${({tokens:e})=>e.theme.backgroundPrimary};
    border: 3px solid ${({tokens:e})=>e.theme.backgroundPrimary};
  }

  .token-badge-container.success {
    background-color: ${({tokens:e})=>e.theme.backgroundPrimary};
    border: 3px solid ${({tokens:e})=>e.theme.backgroundPrimary};
  }

  .token-image-container {
    position: relative;
  }

  .token-image {
    border-radius: ${({borderRadius:e})=>e.round};
    width: 64px;
    height: 64px;
  }

  .token-image.success {
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
  }

  .token-image.error {
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
  }

  .token-image.loading {
    background: ${({colors:e})=>e.accent010};
  }

  .token-image wui-icon {
    width: 32px;
    height: 32px;
  }

  .token-badge {
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    border: 1px solid ${({tokens:e})=>e.theme.foregroundSecondary};
    border-radius: ${({borderRadius:e})=>e[4]};
  }

  .token-badge wui-text {
    white-space: nowrap;
  }

  .payment-lifecycle-container {
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    border-top-right-radius: ${({borderRadius:e})=>e[6]};
    border-top-left-radius: ${({borderRadius:e})=>e[6]};
  }

  .payment-step-badge {
    padding: ${({spacing:e})=>e[1]} ${({spacing:e})=>e[2]};
    border-radius: ${({borderRadius:e})=>e[1]};
  }

  .payment-step-badge.loading {
    background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
  }

  .payment-step-badge.error {
    background-color: ${({tokens:e})=>e.core.backgroundError};
  }

  .payment-step-badge.success {
    background-color: ${({tokens:e})=>e.core.backgroundSuccess};
  }

  .step-icon-container {
    position: relative;
    height: 40px;
    width: 40px;
    border-radius: ${({borderRadius:e})=>e.round};
    background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
  }

  .step-icon-box {
    position: absolute;
    right: -4px;
    bottom: -1px;
    padding: 2px;
    border-radius: ${({borderRadius:e})=>e.round};
    border: 2px solid ${({tokens:e})=>e.theme.backgroundPrimary};
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
  }

  .step-icon-box.success {
    background-color: ${({tokens:e})=>e.core.backgroundSuccess};
  }
`,H=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},Xe={received:[`pending`,`success`,`submitted`],processing:[`success`,`submitted`],sending:[`success`,`submitted`]},Ze=3e3,U=class extends g{constructor(){super(),this.unsubscribe=[],this.pollingInterval=null,this.paymentAsset=L.state.paymentAsset,this.quoteStatus=L.state.quoteStatus,this.quote=L.state.quote,this.amount=L.state.amount,this.namespace=void 0,this.caipAddress=void 0,this.profileName=null,this.activeConnectorIds=s.state.activeConnectorIds,this.selectedExchange=L.state.selectedExchange,this.initializeNamespace(),this.unsubscribe.push(L.subscribeKey(`quoteStatus`,e=>this.quoteStatus=e),L.subscribeKey(`quote`,e=>this.quote=e),s.subscribeKey(`activeConnectorIds`,e=>this.activeConnectorIds=e),L.subscribeKey(`selectedExchange`,e=>this.selectedExchange=e))}connectedCallback(){super.connectedCallback(),this.startPolling()}disconnectedCallback(){super.disconnectedCallback(),this.stopPolling(),this.unsubscribe.forEach(e=>e())}render(){return _`
      <wui-flex flexDirection="column" .padding=${[`3`,`0`,`0`,`0`]} gap="2">
        ${this.tokenTemplate()} ${this.paymentTemplate()} ${this.paymentLifecycleTemplate()}
      </wui-flex>
    `}tokenTemplate(){let e=P(this.amount||`0`),t=this.paymentAsset.metadata.symbol??`Unknown`,n=f.getAllRequestedCaipNetworks().find(e=>e.caipNetworkId===this.paymentAsset.network),i=this.quoteStatus===`failure`||this.quoteStatus===`timeout`||this.quoteStatus===`refund`;return this.quoteStatus===`success`||this.quoteStatus===`submitted`?_`<wui-flex alignItems="center" justifyContent="center">
        <wui-flex justifyContent="center" alignItems="center" class="token-image success">
          <wui-icon name="checkmark" color="success" size="inherit"></wui-icon>
        </wui-flex>
      </wui-flex>`:i?_`<wui-flex alignItems="center" justifyContent="center">
        <wui-flex justifyContent="center" alignItems="center" class="token-image error">
          <wui-icon name="close" color="error" size="inherit"></wui-icon>
        </wui-flex>
      </wui-flex>`:_`
      <wui-flex alignItems="center" justifyContent="center">
        <wui-flex class="token-image-container">
          <wui-pulse size="125px" rings="3" duration="4" opacity="0.5" variant="accent-primary">
            <wui-flex justifyContent="center" alignItems="center" class="token-image loading">
              <wui-icon name="paperPlaneTitle" color="accent-primary" size="inherit"></wui-icon>
            </wui-flex>
          </wui-pulse>

          <wui-flex
            justifyContent="center"
            alignItems="center"
            class="token-badge-container loading"
          >
            <wui-flex
              alignItems="center"
              justifyContent="center"
              gap="01"
              padding="1"
              class="token-badge"
            >
              <wui-image
                src=${y(r.getNetworkImage(n))}
                class="chain-image"
                size="mdl"
              ></wui-image>

              <wui-text variant="lg-regular" color="primary">${e} ${t}</wui-text>
            </wui-flex>
          </wui-flex>
        </wui-flex>
      </wui-flex>
    `}paymentTemplate(){return _`
      <wui-flex flexDirection="column" gap="2" .padding=${[`0`,`6`,`0`,`6`]}>
        ${this.renderPayment()}
        <wui-separator></wui-separator>
        ${this.renderWallet()}
      </wui-flex>
    `}paymentLifecycleTemplate(){let e=this.getStepsWithStatus();return _`
      <wui-flex flexDirection="column" padding="4" gap="2" class="payment-lifecycle-container">
        <wui-flex alignItems="center" justifyContent="space-between">
          <wui-text variant="md-regular" color="secondary">PAYMENT CYCLE</wui-text>

          ${this.renderPaymentCycleBadge()}
        </wui-flex>

        <wui-flex flexDirection="column" gap="5" .padding=${[`2`,`0`,`2`,`0`]}>
          ${e.map(e=>this.renderStep(e))}
        </wui-flex>
      </wui-flex>
    `}renderPaymentCycleBadge(){let e=this.quoteStatus===`failure`||this.quoteStatus===`timeout`||this.quoteStatus===`refund`,t=this.quoteStatus===`success`||this.quoteStatus===`submitted`;return e?_`
        <wui-flex
          justifyContent="center"
          alignItems="center"
          class="payment-step-badge error"
          gap="1"
        >
          <wui-icon name="close" color="error" size="xs"></wui-icon>
          <wui-text variant="sm-regular" color="error">Failed</wui-text>
        </wui-flex>
      `:t?_`
        <wui-flex
          justifyContent="center"
          alignItems="center"
          class="payment-step-badge success"
          gap="1"
        >
          <wui-icon name="checkmark" color="success" size="xs"></wui-icon>
          <wui-text variant="sm-regular" color="success">Completed</wui-text>
        </wui-flex>
      `:_`
      <wui-flex alignItems="center" justifyContent="space-between" gap="3">
        <wui-flex
          justifyContent="center"
          alignItems="center"
          class="payment-step-badge loading"
          gap="1"
        >
          <wui-icon name="clock" color="default" size="xs"></wui-icon>
          <wui-text variant="sm-regular" color="primary">Est. ${this.quote?.timeInSeconds??0} sec</wui-text>
        </wui-flex>

        <wui-icon name="chevronBottom" color="default" size="xxs"></wui-icon>
      </wui-flex>
    `}renderPayment(){let e=f.getAllRequestedCaipNetworks().find(e=>{let t=this.quote?.origin.currency.network;if(!t)return!1;let{chainId:n}=d.parseCaipNetworkId(t);return C.isLowerCaseMatch(e.id.toString(),n.toString())});return _`
      <wui-flex
        alignItems="flex-start"
        justifyContent="space-between"
        .padding=${[`3`,`0`,`3`,`0`]}
      >
        <wui-text variant="lg-regular" color="secondary">Payment Method</wui-text>

        <wui-flex flexDirection="column" alignItems="flex-end" gap="1">
          <wui-flex alignItems="center" gap="01">
            <wui-text variant="lg-regular" color="primary">${P(c.formatNumber(this.quote?.origin.amount||`0`,{decimals:this.quote?.origin.currency.metadata.decimals??0}).toString())}</wui-text>
            <wui-text variant="lg-regular" color="secondary">${this.quote?.origin.currency.metadata.symbol??`Unknown`}</wui-text>
          </wui-flex>

          <wui-flex alignItems="center" gap="1">
            <wui-text variant="md-regular" color="secondary">on</wui-text>
            <wui-image
              src=${y(r.getNetworkImage(e))}
              size="xs"
            ></wui-image>
            <wui-text variant="md-regular" color="secondary">${e?.name}</wui-text>
          </wui-flex>
        </wui-flex>
      </wui-flex>
    `}renderWallet(){return _`
      <wui-flex
        alignItems="flex-start"
        justifyContent="space-between"
        .padding=${[`3`,`0`,`3`,`0`]}
      >
        <wui-text variant="lg-regular" color="secondary"
          >${this.selectedExchange?`Exchange`:`Wallet`}</wui-text
        >

        ${this.renderWalletText()}
      </wui-flex>
    `}renderWalletText(){let{image:e}=this.getWalletProperties({namespace:this.namespace}),{address:t}=this.caipAddress?d.parseCaipAddress(this.caipAddress):{},n=this.selectedExchange?.name;return this.selectedExchange?_`
        <wui-flex alignItems="center" justifyContent="flex-end" gap="1">
          <wui-text variant="lg-regular" color="primary">${n}</wui-text>
          <wui-image src=${y(this.selectedExchange.imageUrl)} size="mdl"></wui-image>
        </wui-flex>
      `:_`
      <wui-flex alignItems="center" justifyContent="flex-end" gap="1">
        <wui-text variant="lg-regular" color="primary">
          ${le.getTruncateString({string:this.profileName||t||n||``,charsStart:this.profileName?16:4,charsEnd:this.profileName?0:6,truncate:this.profileName?`end`:`middle`})}
        </wui-text>

        <wui-image src=${y(e)} size="mdl"></wui-image>
      </wui-flex>
    `}getStepsWithStatus(){return this.quoteStatus===`failure`||this.quoteStatus===`timeout`||this.quoteStatus===`refund`?qe.map(e=>({...e,status:`failed`})):qe.map(e=>{let t=(Xe[e.id]??[]).includes(this.quoteStatus)?`completed`:`pending`;return{...e,status:t}})}renderStep({title:e,icon:t,status:n}){return _`
      <wui-flex alignItems="center" gap="3">
        <wui-flex justifyContent="center" alignItems="center" class="step-icon-container">
          <wui-icon name=${t} color="default" size="mdl"></wui-icon>

          <wui-flex alignItems="center" justifyContent="center" class=${ue({"step-icon-box":!0,success:n===`completed`})}>
            ${this.renderStatusIndicator(n)}
          </wui-flex>
        </wui-flex>

        <wui-text variant="md-regular" color="primary">${e}</wui-text>
      </wui-flex>
    `}renderStatusIndicator(e){return e===`completed`?_`<wui-icon size="sm" color="success" name="checkmark"></wui-icon>`:e===`failed`?_`<wui-icon size="sm" color="error" name="close"></wui-icon>`:e===`pending`?_`<wui-loading-spinner color="accent-primary" size="sm"></wui-loading-spinner>`:null}startPolling(){this.pollingInterval||=(this.fetchQuoteStatus(),setInterval(()=>{this.fetchQuoteStatus()},Ze))}stopPolling(){this.pollingInterval&&=(clearInterval(this.pollingInterval),null)}async fetchQuoteStatus(){let e=L.state.requestId;if(!e||Je.includes(this.quoteStatus))this.stopPolling();else try{await L.fetchQuoteStatus({requestId:e}),Je.includes(this.quoteStatus)&&this.stopPolling()}catch{this.stopPolling()}}initializeNamespace(){let e=f.state.activeChain;this.namespace=e,this.caipAddress=f.getAccountData(e)?.caipAddress,this.profileName=f.getAccountData(e)?.profileName??null,this.unsubscribe.push(f.subscribeChainProp(`accountState`,e=>{this.caipAddress=e?.caipAddress,this.profileName=e?.profileName??null},e))}getWalletProperties({namespace:e}){if(!e)return{name:void 0,image:void 0};let t=this.activeConnectorIds[e];if(!t)return{name:void 0,image:void 0};let n=s.getConnector({id:t,namespace:e});if(!n)return{name:void 0,image:void 0};let i=r.getConnectorImage(n);return{name:n.name,image:i}}};U.styles=Ye,H([b()],U.prototype,`paymentAsset`,void 0),H([b()],U.prototype,`quoteStatus`,void 0),H([b()],U.prototype,`quote`,void 0),H([b()],U.prototype,`amount`,void 0),H([b()],U.prototype,`namespace`,void 0),H([b()],U.prototype,`caipAddress`,void 0),H([b()],U.prototype,`profileName`,void 0),H([b()],U.prototype,`activeConnectorIds`,void 0),H([b()],U.prototype,`selectedExchange`,void 0),U=H([x(`w3m-pay-loading-view`)],U);var Qe=ae`
  :host {
    display: block;
  }
`,$e=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},W=class extends g{render(){return _`
      <wui-flex flexDirection="column" gap="4">
        <wui-flex alignItems="center" justifyContent="space-between">
          <wui-text variant="md-regular" color="secondary">Pay</wui-text>
          <wui-shimmer width="60px" height="16px" borderRadius="4xs" variant="light"></wui-shimmer>
        </wui-flex>

        <wui-flex alignItems="center" justifyContent="space-between">
          <wui-text variant="md-regular" color="secondary">Network Fee</wui-text>

          <wui-flex flexDirection="column" alignItems="flex-end" gap="2">
            <wui-shimmer
              width="75px"
              height="16px"
              borderRadius="4xs"
              variant="light"
            ></wui-shimmer>

            <wui-flex alignItems="center" gap="01">
              <wui-shimmer width="14px" height="14px" rounded variant="light"></wui-shimmer>
              <wui-shimmer
                width="49px"
                height="14px"
                borderRadius="4xs"
                variant="light"
              ></wui-shimmer>
            </wui-flex>
          </wui-flex>
        </wui-flex>

        <wui-flex alignItems="center" justifyContent="space-between">
          <wui-text variant="md-regular" color="secondary">Service Fee</wui-text>
          <wui-shimmer width="75px" height="16px" borderRadius="4xs" variant="light"></wui-shimmer>
        </wui-flex>
      </wui-flex>
    `}};W.styles=[Qe],W=$e([x(`w3m-pay-fees-skeleton`)],W);var et=v`
  :host {
    display: block;
  }

  wui-image {
    border-radius: ${({borderRadius:e})=>e.round};
  }
`,tt=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},G=class extends g{constructor(){super(),this.unsubscribe=[],this.quote=L.state.quote,this.unsubscribe.push(L.subscribeKey(`quote`,e=>this.quote=e))}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){return _`
      <wui-flex flexDirection="column" gap="4">
        <wui-flex alignItems="center" justifyContent="space-between">
          <wui-text variant="md-regular" color="secondary">Pay</wui-text>
          <wui-text variant="md-regular" color="primary">
            ${c.formatNumber(this.quote?.origin.amount||`0`,{decimals:this.quote?.origin.currency.metadata.decimals??0,round:6}).toString()} ${this.quote?.origin.currency.metadata.symbol||`Unknown`}
          </wui-text>
        </wui-flex>

        ${this.quote&&this.quote.fees.length>0?this.quote.fees.map(e=>this.renderFee(e)):null}
      </wui-flex>
    `}renderFee(e){let t=e.id===`network`,n=c.formatNumber(e.amount||`0`,{decimals:e.currency.metadata.decimals??0,round:6}).toString();if(t){let t=f.getAllRequestedCaipNetworks().find(t=>C.isLowerCaseMatch(t.caipNetworkId,e.currency.network));return _`
        <wui-flex alignItems="center" justifyContent="space-between">
          <wui-text variant="md-regular" color="secondary">${e.label}</wui-text>

          <wui-flex flexDirection="column" alignItems="flex-end" gap="2">
            <wui-text variant="md-regular" color="primary">
              ${n} ${e.currency.metadata.symbol||`Unknown`}
            </wui-text>

            <wui-flex alignItems="center" gap="01">
              <wui-image
                src=${y(r.getNetworkImage(t))}
                size="xs"
              ></wui-image>
              <wui-text variant="sm-regular" color="secondary">
                ${t?.name||`Unknown`}
              </wui-text>
            </wui-flex>
          </wui-flex>
        </wui-flex>
      `}return _`
      <wui-flex alignItems="center" justifyContent="space-between">
        <wui-text variant="md-regular" color="secondary">${e.label}</wui-text>
        <wui-text variant="md-regular" color="primary">
          ${n} ${e.currency.metadata.symbol||`Unknown`}
        </wui-text>
      </wui-flex>
    `}};G.styles=[et],tt([b()],G.prototype,`quote`,void 0),G=tt([x(`w3m-pay-fees`)],G);var nt=v`
  :host {
    display: block;
    width: 100%;
  }

  .disabled-container {
    padding: ${({spacing:e})=>e[2]};
    min-height: 168px;
  }

  wui-icon {
    width: ${({spacing:e})=>e[8]};
    height: ${({spacing:e})=>e[8]};
  }

  wui-flex > wui-text {
    max-width: 273px;
  }
`,rt=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},K=class extends g{constructor(){super(),this.unsubscribe=[],this.selectedExchange=L.state.selectedExchange,this.unsubscribe.push(L.subscribeKey(`selectedExchange`,e=>this.selectedExchange=e))}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){return _`
      <wui-flex
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        gap="3"
        class="disabled-container"
      >
        <wui-icon name="coins" color="default" size="inherit"></wui-icon>

        <wui-text variant="md-regular" color="primary" align="center">
          You don't have enough funds to complete this transaction
        </wui-text>

        ${this.selectedExchange?null:_`<wui-button
              size="md"
              variant="neutral-secondary"
              @click=${this.dispatchConnectOtherWalletEvent.bind(this)}
              >Connect other wallet</wui-button
            >`}
      </wui-flex>
    `}dispatchConnectOtherWalletEvent(){this.dispatchEvent(new CustomEvent(`connectOtherWallet`,{detail:!0,bubbles:!0,composed:!0}))}};K.styles=[nt],rt([S({type:Array})],K.prototype,`selectedExchange`,void 0),K=rt([x(`w3m-pay-options-empty`)],K);var it=v`
  :host {
    display: block;
    width: 100%;
  }

  .pay-options-container {
    max-height: 196px;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
  }

  .pay-options-container::-webkit-scrollbar {
    display: none;
  }

  .pay-option-container {
    border-radius: ${({borderRadius:e})=>e[4]};
    padding: ${({spacing:e})=>e[3]};
    min-height: 60px;
  }

  .token-images-container {
    position: relative;
    justify-content: center;
    align-items: center;
  }

  .chain-image {
    position: absolute;
    bottom: -3px;
    right: -5px;
    border: 2px solid ${({tokens:e})=>e.theme.foregroundSecondary};
  }
`,at=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},q=class extends g{render(){return _`
      <wui-flex flexDirection="column" gap="2" class="pay-options-container">
        ${this.renderOptionEntry()} ${this.renderOptionEntry()} ${this.renderOptionEntry()}
      </wui-flex>
    `}renderOptionEntry(){return _`
      <wui-flex
        alignItems="center"
        justifyContent="space-between"
        gap="2"
        class="pay-option-container"
      >
        <wui-flex alignItems="center" gap="2">
          <wui-flex class="token-images-container">
            <wui-shimmer
              width="32px"
              height="32px"
              rounded
              variant="light"
              class="token-image"
            ></wui-shimmer>
            <wui-shimmer
              width="16px"
              height="16px"
              rounded
              variant="light"
              class="chain-image"
            ></wui-shimmer>
          </wui-flex>

          <wui-flex flexDirection="column" gap="1">
            <wui-shimmer
              width="74px"
              height="16px"
              borderRadius="4xs"
              variant="light"
            ></wui-shimmer>
            <wui-shimmer
              width="46px"
              height="14px"
              borderRadius="4xs"
              variant="light"
            ></wui-shimmer>
          </wui-flex>
        </wui-flex>
      </wui-flex>
    `}};q.styles=[it],q=at([x(`w3m-pay-options-skeleton`)],q);var ot=v`
  :host {
    display: block;
    width: 100%;
  }

  .pay-options-container {
    max-height: 196px;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
    mask-image: var(--options-mask-image);
    -webkit-mask-image: var(--options-mask-image);
  }

  .pay-options-container::-webkit-scrollbar {
    display: none;
  }

  .pay-option-container {
    cursor: pointer;
    border-radius: ${({borderRadius:e})=>e[4]};
    padding: ${({spacing:e})=>e[3]};
    transition: background-color ${({durations:e})=>e.lg}
      ${({easings:e})=>e[`ease-out-power-1`]};
    will-change: background-color;
  }

  .token-images-container {
    position: relative;
    justify-content: center;
    align-items: center;
  }

  .token-image {
    border-radius: ${({borderRadius:e})=>e.round};
    width: 32px;
    height: 32px;
  }

  .chain-image {
    position: absolute;
    width: 16px;
    height: 16px;
    bottom: -3px;
    right: -5px;
    border-radius: ${({borderRadius:e})=>e.round};
    border: 2px solid ${({tokens:e})=>e.theme.backgroundPrimary};
  }

  @media (hover: hover) and (pointer: fine) {
    .pay-option-container:hover {
      background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    }
  }
`,J=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},st=300,Y=class extends g{constructor(){super(),this.unsubscribe=[],this.options=[],this.selectedPaymentAsset=null}disconnectedCallback(){this.unsubscribe.forEach(e=>e()),this.resizeObserver?.disconnect(),(this.shadowRoot?.querySelector(`.pay-options-container`))?.removeEventListener(`scroll`,this.handleOptionsListScroll.bind(this))}firstUpdated(){let e=this.shadowRoot?.querySelector(`.pay-options-container`);e&&(requestAnimationFrame(this.handleOptionsListScroll.bind(this)),e?.addEventListener(`scroll`,this.handleOptionsListScroll.bind(this)),this.resizeObserver=new ResizeObserver(()=>{this.handleOptionsListScroll()}),this.resizeObserver?.observe(e),this.handleOptionsListScroll())}render(){return _`
      <wui-flex flexDirection="column" gap="2" class="pay-options-container">
        ${this.options.map(e=>this.payOptionTemplate(e))}
      </wui-flex>
    `}payOptionTemplate(e){let{network:t,metadata:n,asset:i,amount:a=`0`}=e,o=f.getAllRequestedCaipNetworks().find(e=>e.caipNetworkId===t),s=`${t}:${i}`==`${this.selectedPaymentAsset?.network}:${this.selectedPaymentAsset?.asset}`,l=c.bigNumber(a,{safe:!0}),ee=l.gt(0);return _`
      <wui-flex
        alignItems="center"
        justifyContent="space-between"
        gap="2"
        @click=${()=>this.onSelect?.(e)}
        class="pay-option-container"
      >
        <wui-flex alignItems="center" gap="2">
          <wui-flex class="token-images-container">
            <wui-image
              src=${y(n.logoURI)}
              class="token-image"
              size="3xl"
            ></wui-image>
            <wui-image
              src=${y(r.getNetworkImage(o))}
              class="chain-image"
              size="md"
            ></wui-image>
          </wui-flex>

          <wui-flex flexDirection="column" gap="1">
            <wui-text variant="lg-regular" color="primary">${n.symbol}</wui-text>
            ${ee?_`<wui-text variant="sm-regular" color="secondary">
                  ${l.round(6).toString()} ${n.symbol}
                </wui-text>`:null}
          </wui-flex>
        </wui-flex>

        ${s?_`<wui-icon name="checkmark" size="md" color="success"></wui-icon>`:null}
      </wui-flex>
    `}handleOptionsListScroll(){let e=this.shadowRoot?.querySelector(`.pay-options-container`);e&&(e.scrollHeight>st?(e.style.setProperty(`--options-mask-image`,`linear-gradient(
          to bottom,
          rgba(0, 0, 0, calc(1 - var(--options-scroll--top-opacity))) 0px,
          rgba(200, 200, 200, calc(1 - var(--options-scroll--top-opacity))) 1px,
          black 50px,
          black calc(100% - 50px),
          rgba(155, 155, 155, calc(1 - var(--options-scroll--bottom-opacity))) calc(100% - 1px),
          rgba(0, 0, 0, calc(1 - var(--options-scroll--bottom-opacity))) 100%
        )`),e.style.setProperty(`--options-scroll--top-opacity`,de.interpolate([0,50],[0,1],e.scrollTop).toString()),e.style.setProperty(`--options-scroll--bottom-opacity`,de.interpolate([0,50],[0,1],e.scrollHeight-e.scrollTop-e.offsetHeight).toString())):(e.style.setProperty(`--options-mask-image`,`none`),e.style.setProperty(`--options-scroll--top-opacity`,`0`),e.style.setProperty(`--options-scroll--bottom-opacity`,`0`)))}};Y.styles=[ot],J([S({type:Array})],Y.prototype,`options`,void 0),J([S()],Y.prototype,`selectedPaymentAsset`,void 0),J([S()],Y.prototype,`onSelect`,void 0),Y=J([x(`w3m-pay-options`)],Y);var ct=v`
  .payment-methods-container {
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    border-top-right-radius: ${({borderRadius:e})=>e[5]};
    border-top-left-radius: ${({borderRadius:e})=>e[5]};
  }

  .pay-options-container {
    background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
    border-radius: ${({borderRadius:e})=>e[5]};
    padding: ${({spacing:e})=>e[1]};
  }

  w3m-tooltip-trigger {
    display: flex;
    align-items: center;
    justify-content: center;
    max-width: fit-content;
  }

  wui-image {
    border-radius: ${({borderRadius:e})=>e.round};
  }

  w3m-pay-options.disabled {
    opacity: 0.5;
    pointer-events: none;
  }
`,X=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},Z={eip155:`ethereum`,solana:`solana`,bip122:`bitcoin`,ton:`ton`},lt={eip155:{icon:Z.eip155,label:`EVM`},solana:{icon:Z.solana,label:`Solana`},bip122:{icon:Z.bip122,label:`Bitcoin`},ton:{icon:Z.ton,label:`Ton`}},Q=class extends g{constructor(){super(),this.unsubscribe=[],this.profileName=null,this.paymentAsset=L.state.paymentAsset,this.namespace=void 0,this.caipAddress=void 0,this.amount=L.state.amount,this.recipient=L.state.recipient,this.activeConnectorIds=s.state.activeConnectorIds,this.selectedPaymentAsset=L.state.selectedPaymentAsset,this.selectedExchange=L.state.selectedExchange,this.isFetchingQuote=L.state.isFetchingQuote,this.quoteError=L.state.quoteError,this.quote=L.state.quote,this.isFetchingTokenBalances=L.state.isFetchingTokenBalances,this.tokenBalances=L.state.tokenBalances,this.isPaymentInProgress=L.state.isPaymentInProgress,this.exchangeUrlForQuote=L.state.exchangeUrlForQuote,this.completedTransactionsCount=0,this.unsubscribe.push(L.subscribeKey(`paymentAsset`,e=>this.paymentAsset=e)),this.unsubscribe.push(L.subscribeKey(`tokenBalances`,e=>this.onTokenBalancesChanged(e))),this.unsubscribe.push(L.subscribeKey(`isFetchingTokenBalances`,e=>this.isFetchingTokenBalances=e)),this.unsubscribe.push(s.subscribeKey(`activeConnectorIds`,e=>this.activeConnectorIds=e)),this.unsubscribe.push(L.subscribeKey(`selectedPaymentAsset`,e=>this.selectedPaymentAsset=e)),this.unsubscribe.push(L.subscribeKey(`isFetchingQuote`,e=>this.isFetchingQuote=e)),this.unsubscribe.push(L.subscribeKey(`quoteError`,e=>this.quoteError=e)),this.unsubscribe.push(L.subscribeKey(`quote`,e=>this.quote=e)),this.unsubscribe.push(L.subscribeKey(`amount`,e=>this.amount=e)),this.unsubscribe.push(L.subscribeKey(`recipient`,e=>this.recipient=e)),this.unsubscribe.push(L.subscribeKey(`isPaymentInProgress`,e=>this.isPaymentInProgress=e)),this.unsubscribe.push(L.subscribeKey(`selectedExchange`,e=>this.selectedExchange=e)),this.unsubscribe.push(L.subscribeKey(`exchangeUrlForQuote`,e=>this.exchangeUrlForQuote=e)),this.resetQuoteState(),this.initializeNamespace(),this.fetchTokens()}disconnectedCallback(){super.disconnectedCallback(),this.resetAssetsState(),this.unsubscribe.forEach(e=>e())}updated(e){super.updated(e),e.has(`selectedPaymentAsset`)&&this.fetchQuote()}render(){return _`
      <wui-flex flexDirection="column">
        ${this.profileTemplate()}

        <wui-flex
          flexDirection="column"
          gap="4"
          class="payment-methods-container"
          .padding=${[`4`,`4`,`5`,`4`]}
        >
          ${this.paymentOptionsViewTemplate()} ${this.amountWithFeeTemplate()}

          <wui-flex
            alignItems="center"
            justifyContent="space-between"
            .padding=${[`1`,`0`,`1`,`0`]}
          >
            <wui-separator></wui-separator>
          </wui-flex>

          ${this.paymentActionsTemplate()}
        </wui-flex>
      </wui-flex>
    `}profileTemplate(){if(this.selectedExchange){let e=c.formatNumber(this.quote?.origin.amount,{decimals:this.quote?.origin.currency.metadata.decimals??0}).toString();return _`
        <wui-flex
          .padding=${[`4`,`3`,`4`,`3`]}
          alignItems="center"
          justifyContent="space-between"
          gap="2"
        >
          <wui-text variant="lg-regular" color="secondary">Paying with</wui-text>

          ${this.quote?_`<wui-text variant="lg-regular" color="primary">
                ${c.bigNumber(e,{safe:!0}).round(6).toString()}
                ${this.quote.origin.currency.metadata.symbol}
              </wui-text>`:_`<wui-shimmer width="80px" height="18px" variant="light"></wui-shimmer>`}
        </wui-flex>
      `}let e=a.getPlainAddress(this.caipAddress)??``,{name:t,image:n}=this.getWalletProperties({namespace:this.namespace}),{icon:r,label:i}=lt[this.namespace]??{};return _`
      <wui-flex
        .padding=${[`4`,`3`,`4`,`3`]}
        alignItems="center"
        justifyContent="space-between"
        gap="2"
      >
        <wui-wallet-switch
          profileName=${y(this.profileName)}
          address=${y(e)}
          imageSrc=${y(n)}
          alt=${y(t)}
          @click=${this.onConnectOtherWallet.bind(this)}
          data-testid="wui-wallet-switch"
        ></wui-wallet-switch>

        <wui-wallet-switch
          profileName=${y(i)}
          address=${y(e)}
          icon=${y(r)}
          iconSize="xs"
          .enableGreenCircle=${!1}
          alt=${y(i)}
          @click=${this.onConnectOtherWallet.bind(this)}
          data-testid="wui-wallet-switch"
        ></wui-wallet-switch>
      </wui-flex>
    `}initializeNamespace(){let e=f.state.activeChain;this.namespace=e,this.caipAddress=f.getAccountData(e)?.caipAddress,this.profileName=f.getAccountData(e)?.profileName??null,this.unsubscribe.push(f.subscribeChainProp(`accountState`,e=>this.onAccountStateChanged(e),e))}async fetchTokens(){if(this.namespace){let e;if(this.caipAddress){let{chainId:t,chainNamespace:n}=d.parseCaipAddress(this.caipAddress),r=`${n}:${t}`;e=f.getAllRequestedCaipNetworks().find(e=>e.caipNetworkId===r)}await L.fetchTokens({caipAddress:this.caipAddress,caipNetwork:e,namespace:this.namespace})}}fetchQuote(){if(this.amount&&this.recipient&&this.selectedPaymentAsset&&this.paymentAsset){let{address:e}=this.caipAddress?d.parseCaipAddress(this.caipAddress):{};L.fetchQuote({amount:this.amount.toString(),address:e,sourceToken:this.selectedPaymentAsset,toToken:this.paymentAsset,recipient:this.recipient})}}getWalletProperties({namespace:e}){if(!e)return{name:void 0,image:void 0};let t=this.activeConnectorIds[e];if(!t)return{name:void 0,image:void 0};let n=s.getConnector({id:t,namespace:e});if(!n)return{name:void 0,image:void 0};let i=r.getConnectorImage(n);return{name:n.name,image:i}}paymentOptionsViewTemplate(){return _`
      <wui-flex flexDirection="column" gap="2">
        <wui-text variant="sm-regular" color="secondary">CHOOSE PAYMENT OPTION</wui-text>
        <wui-flex class="pay-options-container">${this.paymentOptionsTemplate()}</wui-flex>
      </wui-flex>
    `}paymentOptionsTemplate(){let e=this.getPaymentAssetFromTokenBalances();return this.isFetchingTokenBalances?_`<w3m-pay-options-skeleton></w3m-pay-options-skeleton>`:e.length===0?_`<w3m-pay-options-empty
        @connectOtherWallet=${this.onConnectOtherWallet.bind(this)}
      ></w3m-pay-options-empty>`:_`<w3m-pay-options
      class=${ue({disabled:this.isFetchingQuote})}
      .options=${e}
      .selectedPaymentAsset=${y(this.selectedPaymentAsset)}
      .onSelect=${this.onSelectedPaymentAssetChanged.bind(this)}
    ></w3m-pay-options>`}amountWithFeeTemplate(){return this.isFetchingQuote||!this.selectedPaymentAsset||this.quoteError?_`<w3m-pay-fees-skeleton></w3m-pay-fees-skeleton>`:_`<w3m-pay-fees></w3m-pay-fees>`}paymentActionsTemplate(){let e=this.isFetchingQuote||this.isFetchingTokenBalances,t=this.isFetchingQuote||this.isFetchingTokenBalances||!this.selectedPaymentAsset||!!this.quoteError,n=c.formatNumber(this.quote?.origin.amount??0,{decimals:this.quote?.origin.currency.metadata.decimals??0}).toString();return this.selectedExchange?e||t?_`
          <wui-shimmer width="100%" height="48px" variant="light" ?rounded=${!0}></wui-shimmer>
        `:_`<wui-button
        size="lg"
        fullWidth
        variant="accent-secondary"
        @click=${this.onPayWithExchange.bind(this)}
      >
        ${`Continue in ${this.selectedExchange.name}`}

        <wui-icon name="arrowRight" color="inherit" size="sm" slot="iconRight"></wui-icon>
      </wui-button>`:_`
      <wui-flex alignItems="center" justifyContent="space-between">
        <wui-flex flexDirection="column" gap="1">
          <wui-text variant="md-regular" color="secondary">Order Total</wui-text>

          ${e||t?_`<wui-shimmer width="58px" height="32px" variant="light"></wui-shimmer>`:_`<wui-flex alignItems="center" gap="01">
                <wui-text variant="h4-regular" color="primary">${P(n)}</wui-text>

                <wui-text variant="lg-regular" color="secondary">
                  ${this.quote?.origin.currency.metadata.symbol||`Unknown`}
                </wui-text>
              </wui-flex>`}
        </wui-flex>

        ${this.actionButtonTemplate({isLoading:e,isDisabled:t})}
      </wui-flex>
    `}actionButtonTemplate(e){let t=A(this.quote),{isLoading:n,isDisabled:r}=e,i=`Pay`;return t.length>1&&this.completedTransactionsCount===0&&(i=`Approve`),_`
      <wui-button
        size="lg"
        variant="accent-primary"
        ?loading=${n||this.isPaymentInProgress}
        ?disabled=${r||this.isPaymentInProgress}
        @click=${()=>{t.length>0?this.onSendTransactions():this.onTransfer()}}
      >
        ${i}
        ${n?null:_`<wui-icon
              name="arrowRight"
              color="inherit"
              size="sm"
              slot="iconRight"
            ></wui-icon>`}
      </wui-button>
    `}getPaymentAssetFromTokenBalances(){return this.namespace?(this.tokenBalances[this.namespace]??[]).map(e=>{try{return Pe(e)}catch{return null}}).filter(e=>!!e).filter(e=>{let{chainId:t}=d.parseCaipNetworkId(e.network),{chainId:n}=d.parseCaipNetworkId(this.paymentAsset.network);return C.isLowerCaseMatch(e.asset,this.paymentAsset.asset)?!0:!this.selectedExchange||!C.isLowerCaseMatch(t.toString(),n.toString())}):[]}onTokenBalancesChanged(e){this.tokenBalances=e;let[t]=this.getPaymentAssetFromTokenBalances();t&&L.setSelectedPaymentAsset(t)}async onConnectOtherWallet(){await s.connect(),await h.open({view:`PayQuote`})}onAccountStateChanged(e){let{address:t}=this.caipAddress?d.parseCaipAddress(this.caipAddress):{};if(this.caipAddress=e?.caipAddress,this.profileName=e?.profileName??null,t){let{address:e}=this.caipAddress?d.parseCaipAddress(this.caipAddress):{};e?C.isLowerCaseMatch(e,t)||(this.resetAssetsState(),this.resetQuoteState(),this.fetchTokens()):h.close()}}onSelectedPaymentAssetChanged(e){this.isFetchingQuote||L.setSelectedPaymentAsset(e)}async onTransfer(){let e=k(this.quote);if(e){if(!C.isLowerCaseMatch(this.selectedPaymentAsset?.asset,e.deposit.currency))throw Error(`Quote asset is not the same as the selected payment asset`);let r=this.selectedPaymentAsset?.amount??`0`,i=c.formatNumber(e.deposit.amount,{decimals:this.selectedPaymentAsset?.metadata.decimals??0}).toString();if(!c.bigNumber(r).gte(i)){n.showError(`Insufficient funds`);return}if(this.quote&&this.selectedPaymentAsset&&this.caipAddress&&this.namespace){let{address:n}=d.parseCaipAddress(this.caipAddress);await L.onTransfer({chainNamespace:this.namespace,fromAddress:n,toAddress:e.deposit.receiver,amount:i,paymentAsset:this.selectedPaymentAsset}),L.setRequestId(e.requestId),t.push(`PayLoading`)}}}async onSendTransactions(){let e=this.selectedPaymentAsset?.amount??`0`,r=c.formatNumber(this.quote?.origin.amount??0,{decimals:this.selectedPaymentAsset?.metadata.decimals??0}).toString();if(!c.bigNumber(e).gte(r)){n.showError(`Insufficient funds`);return}let i=A(this.quote),[a]=A(this.quote,this.completedTransactionsCount);a&&this.namespace&&(await L.onSendTransaction({namespace:this.namespace,transactionStep:a}),this.completedTransactionsCount+=1,this.completedTransactionsCount===i.length&&(L.setRequestId(a.requestId),t.push(`PayLoading`)))}onPayWithExchange(){if(this.exchangeUrlForQuote){let e=a.returnOpenHref(``,`popupWindow`,`scrollbar=yes,width=480,height=720`);if(!e)throw Error(`Could not create popup window`);e.location.href=this.exchangeUrlForQuote;let n=k(this.quote);n&&L.setRequestId(n.requestId),L.initiatePayment(),t.push(`PayLoading`)}}resetAssetsState(){L.setSelectedPaymentAsset(null)}resetQuoteState(){L.resetQuoteState()}};Q.styles=ct,X([b()],Q.prototype,`profileName`,void 0),X([b()],Q.prototype,`paymentAsset`,void 0),X([b()],Q.prototype,`namespace`,void 0),X([b()],Q.prototype,`caipAddress`,void 0),X([b()],Q.prototype,`amount`,void 0),X([b()],Q.prototype,`recipient`,void 0),X([b()],Q.prototype,`activeConnectorIds`,void 0),X([b()],Q.prototype,`selectedPaymentAsset`,void 0),X([b()],Q.prototype,`selectedExchange`,void 0),X([b()],Q.prototype,`isFetchingQuote`,void 0),X([b()],Q.prototype,`quoteError`,void 0),X([b()],Q.prototype,`quote`,void 0),X([b()],Q.prototype,`isFetchingTokenBalances`,void 0),X([b()],Q.prototype,`tokenBalances`,void 0),X([b()],Q.prototype,`isPaymentInProgress`,void 0),X([b()],Q.prototype,`exchangeUrlForQuote`,void 0),X([b()],Q.prototype,`completedTransactionsCount`,void 0),Q=X([x(`w3m-pay-quote-view`)],Q);var ut=3e5;async function dt(e){return L.handleOpenPay(e)}async function ft(e,t=ut){if(t<=0)throw new O(E.INVALID_PAYMENT_CONFIG,`Timeout must be greater than 0`);try{await dt(e)}catch(e){throw e instanceof O?e:new O(E.UNABLE_TO_INITIATE_PAYMENT,e.message)}return new Promise((e,n)=>{let r=!1,i=setTimeout(()=>{r||(r=!0,o(),n(new O(E.GENERIC_PAYMENT_ERROR,`Payment timeout`)))},t);function a(){if(r)return;let t=L.state.currentPayment,n=L.state.error,a=L.state.isPaymentInProgress;if(t?.status===`SUCCESS`){r=!0,o(),clearTimeout(i),e({success:!0,result:t.result});return}if(t?.status===`FAILED`){r=!0,o(),clearTimeout(i),e({success:!1,error:n||`Payment failed`});return}n&&!a&&!t&&(r=!0,o(),clearTimeout(i),e({success:!1,error:n}))}let o=_t([$(`currentPayment`,a),$(`error`,a),$(`isPaymentInProgress`,a)]);a()})}function pt(){return L.getExchanges()}function mt(){return L.state.currentPayment?.result}function ht(){return L.state.error}function gt(){return L.state.isPaymentInProgress}function $(e,t){return L.subscribeKey(e,t)}function _t(e){return()=>{e.forEach(e=>{try{e()}catch{}})}}var vt={network:`eip155:8453`,asset:`native`,metadata:{name:`Ethereum`,symbol:`ETH`,decimals:18}},yt={network:`eip155:8453`,asset:`0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`,metadata:{name:`USD Coin`,symbol:`USDC`,decimals:6}},bt={network:`eip155:84532`,asset:`native`,metadata:{name:`Ethereum`,symbol:`ETH`,decimals:18}},xt={network:`eip155:1`,asset:`0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`,metadata:{name:`USD Coin`,symbol:`USDC`,decimals:6}},St={network:`eip155:10`,asset:`0x0b2c639c533813f4aa9d7837caf62653d097ff85`,metadata:{name:`USD Coin`,symbol:`USDC`,decimals:6}},Ct={network:`eip155:42161`,asset:`0xaf88d065e77c8cC2239327C5EDb3A432268e5831`,metadata:{name:`USD Coin`,symbol:`USDC`,decimals:6}},wt={network:`eip155:137`,asset:`0x3c499c542cef5e3811e1192ce70d8cc03d5c3359`,metadata:{name:`USD Coin`,symbol:`USDC`,decimals:6}},Tt={network:`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`,asset:`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`,metadata:{name:`USD Coin`,symbol:`USDC`,decimals:6}},Et={network:`eip155:1`,asset:`0xdAC17F958D2ee523a2206206994597C13D831ec7`,metadata:{name:`Tether USD`,symbol:`USDT`,decimals:6}},Dt={network:`eip155:10`,asset:`0x94b008aA00579c1307B0EF2c499aD98a8ce58e58`,metadata:{name:`Tether USD`,symbol:`USDT`,decimals:6}},Ot={network:`eip155:42161`,asset:`0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9`,metadata:{name:`Tether USD`,symbol:`USDT`,decimals:6}},kt={network:`eip155:137`,asset:`0xc2132d05d31c914a87c6611c10748aeb04b58e8f`,metadata:{name:`Tether USD`,symbol:`USDT`,decimals:6}},At={network:`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`,asset:`Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`,metadata:{name:`Tether USD`,symbol:`USDT`,decimals:6}},jt={network:`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`,asset:`native`,metadata:{name:`Solana`,symbol:`SOL`,decimals:9}};export{z as C,U as S,ht as _,yt as a,ft as b,St as c,kt as d,jt as f,gt as g,pt as h,bt as i,Dt as l,At as m,Ot as n,xt as o,Tt as p,vt as r,Et as s,Ct as t,wt as u,mt as v,L as w,Q as x,dt as y};