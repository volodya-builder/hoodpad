import{C as e,D as t,F as n,V as r,l as i,r as a}from"./ApiController-CoZQckiV.js";import{c as o,f as s,o as c,r as l,t as u}from"./exports-ClBc5snA.js";import{c as d,l as f,o as p,u as m}from"./wui-text-CHT8qwsR.js";import{t as h}from"./ExchangeController-D4BR2fbd.js";import"./wui-button-BGnwBRIj.js";import"./wui-icon-C9RQLkXg.js";import"./wui-icon-link-DgOSN4JJ.js";import"./wui-image-DykLASQL.js";import"./wui-image-BLTAxC4L.js";import"./wui-list-item-CHtAyzWN.js";import"./wui-separator-CZZbGxhV.js";import"./wui-shimmer-C-80YCXB.js";import"./wui-link-PMg2t-_z.js";import"./wui-icon-box-B_dZs8ZY.js";import"./wui-list-token-CpjKiBlW.js";import"./wui-input-text-DBjsfi1I.js";import"./wui-input-amount-DXO5gmQH.js";var g=c`
  button {
    border: none;
    border-radius: ${({borderRadius:e})=>e[20]};
    display: flex;
    flex-direction: row;
    align-items: center;
    padding: ${({spacing:e})=>e[1]};
    transition:
      background-color ${({durations:e})=>e.lg}
        ${({easings:e})=>e[`ease-out-power-2`]},
      box-shadow ${({durations:e})=>e.lg}
        ${({easings:e})=>e[`ease-out-power-2`]};
    will-change: background-color, box-shadow;
  }

  /* -- Variants --------------------------------------------------------------- */
  button[data-type='accent'] {
    background-color: ${({tokens:e})=>e.core.backgroundAccentPrimary};
    color: ${({tokens:e})=>e.theme.textPrimary};
  }

  button[data-type='neutral'] {
    background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
    color: ${({tokens:e})=>e.theme.textPrimary};
  }

  /* -- Sizes --------------------------------------------------------------- */
  button[data-size='sm'] {
    height: 24px;
  }

  button[data-size='md'] {
    height: 28px;
  }

  button[data-size='lg'] {
    height: 32px;
  }

  button[data-size='sm'] > wui-image,
  button[data-size='sm'] > wui-icon {
    width: 16px;
    height: 16px;
  }

  button[data-size='md'] > wui-image,
  button[data-size='md'] > wui-icon {
    width: 20px;
    height: 20px;
  }

  button[data-size='lg'] > wui-image,
  button[data-size='lg'] > wui-icon {
    width: 24px;
    height: 24px;
  }

  wui-text {
    padding-left: ${({spacing:e})=>e[1]};
    padding-right: ${({spacing:e})=>e[1]};
  }

  wui-image {
    border-radius: ${({borderRadius:e})=>e[3]};
    overflow: hidden;
    user-drag: none;
    user-select: none;
    -moz-user-select: none;
    -webkit-user-drag: none;
    -webkit-user-select: none;
    -ms-user-select: none;
  }

  /* -- States --------------------------------------------------------------- */
  @media (hover: hover) and (pointer: fine) {
    button[data-type='accent']:not(:disabled):hover {
      background-color: ${({tokens:e})=>e.core.foregroundAccent060};
    }

    button[data-type='neutral']:not(:disabled):hover {
      background-color: ${({tokens:e})=>e.theme.foregroundTertiary};
    }
  }

  button[data-type='accent']:not(:disabled):focus-visible,
  button[data-type='accent']:not(:disabled):active {
    box-shadow: 0 0 0 4px ${({tokens:e})=>e.core.foregroundAccent020};
  }

  button[data-type='neutral']:not(:disabled):focus-visible,
  button[data-type='neutral']:not(:disabled):active {
    box-shadow: 0 0 0 4px ${({tokens:e})=>e.core.foregroundAccent020};
  }

  button:disabled {
    opacity: 0.5;
  }
`,_=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},v={sm:`sm-regular`,md:`md-regular`,lg:`lg-regular`},y=class extends o{constructor(){super(...arguments),this.type=`accent`,this.size=`md`,this.imageSrc=``,this.disabled=!1,this.leftIcon=void 0,this.rightIcon=void 0,this.text=``}render(){return s`
      <button ?disabled=${this.disabled} data-type=${this.type} data-size=${this.size}>
        ${this.imageSrc?s`<wui-image src=${this.imageSrc}></wui-image>`:null}
        ${this.leftIcon?s`<wui-icon name=${this.leftIcon} color="inherit" size="inherit"></wui-icon>`:null}
        <wui-text variant=${v[this.size]} color="inherit">${this.text}</wui-text>
        ${this.rightIcon?s`<wui-icon name=${this.rightIcon} color="inherit" size="inherit"></wui-icon>`:null}
      </button>
    `}};y.styles=[l,u,g],_([m()],y.prototype,`type`,void 0),_([m()],y.prototype,`size`,void 0),_([m()],y.prototype,`imageSrc`,void 0),_([m({type:Boolean})],y.prototype,`disabled`,void 0),_([m()],y.prototype,`leftIcon`,void 0),_([m()],y.prototype,`rightIcon`,void 0),_([m()],y.prototype,`text`,void 0),y=_([p(`wui-chip-button`)],y);var b=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},x=class extends o{constructor(){super(...arguments),this.maxDecimals=void 0,this.maxIntegers=void 0}render(){return s`
      <wui-flex alignItems="center" gap="1">
        <wui-input-amount
          widthVariant="fit"
          fontSize="h2"
          .maxDecimals=${d(this.maxDecimals)}
          .maxIntegers=${d(this.maxIntegers)}
          .value=${this.amount?String(this.amount):``}
        ></wui-input-amount>
        <wui-text variant="md-regular" color="secondary">USD</wui-text>
      </wui-flex>
    `}};b([m({type:Number})],x.prototype,`amount`,void 0),b([m({type:Number})],x.prototype,`maxDecimals`,void 0),b([m({type:Number})],x.prototype,`maxIntegers`,void 0),x=b([p(`w3m-fund-input`)],x);var S=c`
  .amount-input-container {
    border-radius: ${({borderRadius:e})=>e[6]};
    border-top-right-radius: 0;
    border-top-left-radius: 0;
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    padding: ${({spacing:e})=>e[1]};
  }

  .container {
    border-radius: 30px;
  }
`,C=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},w=[10,50,100],T=6,E=10,D=class extends o{constructor(){super(),this.unsubscribe=[],this.network=a.state.activeCaipNetwork,this.exchanges=h.state.exchanges,this.isLoading=h.state.isLoading,this.amount=h.state.amount,this.tokenAmount=h.state.tokenAmount,this.priceLoading=h.state.priceLoading,this.isPaymentInProgress=h.state.isPaymentInProgress,this.currentPayment=h.state.currentPayment,this.paymentId=h.state.paymentId,this.paymentAsset=h.state.paymentAsset,this.unsubscribe.push(a.subscribeKey(`activeCaipNetwork`,e=>{this.network=e,this.setDefaultPaymentAsset()}),h.subscribe(e=>{this.exchanges=e.exchanges,this.isLoading=e.isLoading,this.amount=e.amount,this.tokenAmount=e.tokenAmount,this.priceLoading=e.priceLoading,this.paymentId=e.paymentId,this.isPaymentInProgress=e.isPaymentInProgress,this.currentPayment=e.currentPayment,this.paymentAsset=e.paymentAsset,e.isPaymentInProgress&&e.currentPayment?.exchangeId&&e.currentPayment?.sessionId&&e.paymentId&&this.handlePaymentInProgress()}))}disconnectedCallback(){this.unsubscribe.forEach(e=>e()),h.state.isPaymentInProgress||h.reset()}async firstUpdated(){await this.getPaymentAssets(),this.paymentAsset||await this.setDefaultPaymentAsset(),h.setAmount(w[0]),await h.fetchExchanges()}render(){return s`
      <wui-flex flexDirection="column" class="container">
        ${this.amountInputTemplate()} ${this.exchangesTemplate()}
      </wui-flex>
    `}exchangesLoadingTemplate(){return Array.from({length:2}).map(()=>s`<wui-shimmer width="100%" height="65px" borderRadius="xxs"></wui-shimmer>`)}_exchangesTemplate(){return this.exchanges.length>0?this.exchanges.map(e=>s`<wui-list-item
              @click=${()=>this.onExchangeClick(e)}
              chevron
              variant="image"
              imageSrc=${e.imageUrl}
              ?loading=${this.isLoading}
            >
              <wui-text variant="md-regular" color="primary">
                Deposit from ${e.name}
              </wui-text>
            </wui-list-item>`):s`<wui-flex flexDirection="column" alignItems="center" gap="4" padding="4">
          <wui-text variant="lg-medium" align="center" color="primary">
            No exchanges support this asset on this network
          </wui-text>
        </wui-flex>`}exchangesTemplate(){return s`<wui-flex
      flexDirection="column"
      gap="2"
      .padding=${[`3`,`3`,`3`,`3`]}
      class="exchanges-container"
    >
      ${this.isLoading?this.exchangesLoadingTemplate():this._exchangesTemplate()}
    </wui-flex>`}amountInputTemplate(){return s`
      <wui-flex
        flexDirection="column"
        .padding=${[`0`,`3`,`3`,`3`]}
        class="amount-input-container"
      >
        <wui-flex
          justifyContent="space-between"
          alignItems="center"
          .margin=${[`0`,`0`,`6`,`0`]}
        >
          <wui-text variant="md-medium" color="secondary">Asset</wui-text>
          <wui-token-button
            data-testid="deposit-from-exchange-asset-button"
            flexDirection="row-reverse"
            text=${this.paymentAsset?.metadata.symbol||``}
            imageSrc=${this.paymentAsset?.metadata.iconUrl||``}
            @click=${()=>e.push(`PayWithExchangeSelectAsset`)}
            size="lg"
            .chainImageSrc=${d(n.getNetworkImage(this.network))}
          >
          </wui-token-button>
        </wui-flex>
        <wui-flex
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          .margin=${[`0`,`0`,`4`,`0`]}
        >
          <w3m-fund-input
            @inputChange=${this.onAmountChange.bind(this)}
            .amount=${this.amount}
            .maxDecimals=${T}
            .maxIntegers=${E}
          >
          </w3m-fund-input>
          ${this.tokenAmountTemplate()}
        </wui-flex>
        <wui-flex justifyContent="center" gap="2">
          ${w.map(e=>s`<wui-chip-button
                @click=${()=>h.setAmount(e)}
                type="neutral"
                size="lg"
                text=${`$${e}`}
              ></wui-chip-button>`)}
        </wui-flex>
      </wui-flex>
    `}tokenAmountTemplate(){return this.priceLoading?s`<wui-shimmer
        width="65px"
        height="20px"
        borderRadius="xxs"
        variant="light"
      ></wui-shimmer>`:s`
      <wui-text variant="md-regular" color="secondary">
        ${this.tokenAmount.toFixed(4)} ${this.paymentAsset?.metadata.symbol}
      </wui-text>
    `}async onExchangeClick(e){if(!this.amount){t.showError(`Please enter an amount`);return}await h.handlePayWithExchange(e.id)}handlePaymentInProgress(){let n=a.state.activeChain,{redirectView:r=`Account`}=e.state.data??{};this.isPaymentInProgress&&this.currentPayment?.exchangeId&&this.currentPayment?.sessionId&&this.paymentId&&(h.waitUntilComplete({exchangeId:this.currentPayment.exchangeId,sessionId:this.currentPayment.sessionId,paymentId:this.paymentId}).then(r=>{r.status===`SUCCESS`?(t.showSuccess(`Deposit completed`),h.reset(),n&&(a.fetchTokenBalance(),i.updateBalance(n)),e.replace(`Transactions`)):r.status===`FAILED`&&t.showError(`Deposit failed`)}),t.showLoading(`Deposit in progress...`),e.replace(r))}onAmountChange({detail:e}){h.setAmount(e?Number(e):null)}async getPaymentAssets(){this.network&&await h.getAssetsForNetwork(this.network.caipNetworkId)}async setDefaultPaymentAsset(){if(this.network){let e=await h.getAssetsForNetwork(this.network.caipNetworkId);e[0]&&h.setPaymentAsset(e[0])}}};D.styles=S,C([f()],D.prototype,`network`,void 0),C([f()],D.prototype,`exchanges`,void 0),C([f()],D.prototype,`isLoading`,void 0),C([f()],D.prototype,`amount`,void 0),C([f()],D.prototype,`tokenAmount`,void 0),C([f()],D.prototype,`priceLoading`,void 0),C([f()],D.prototype,`isPaymentInProgress`,void 0),C([f()],D.prototype,`currentPayment`,void 0),C([f()],D.prototype,`paymentId`,void 0),C([f()],D.prototype,`paymentAsset`,void 0),D=C([p(`w3m-deposit-from-exchange-view`)],D);var O=c`
  .contentContainer {
    height: 440px;
    overflow: scroll;
    scrollbar-width: none;
  }

  .contentContainer::-webkit-scrollbar {
    display: none;
  }

  wui-icon-box {
    width: 40px;
    height: 40px;
    border-radius: ${({borderRadius:e})=>e[3]};
  }
`,k=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},A=class extends o{constructor(){super(),this.unsubscribe=[],this.assets=h.state.assets,this.search=``,this.onDebouncedSearch=r.debounce(e=>{this.search=e}),this.unsubscribe.push(h.subscribe(e=>{this.assets=e.assets}))}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){return s`
      <wui-flex flexDirection="column">
        ${this.templateSearchInput()} <wui-separator></wui-separator> ${this.templateTokens()}
      </wui-flex>
    `}templateSearchInput(){return s`
      <wui-flex gap="2" padding="3">
        <wui-input-text
          @inputChange=${this.onInputChange.bind(this)}
          class="network-search-input"
          size="sm"
          placeholder="Search token"
          icon="search"
        ></wui-input-text>
      </wui-flex>
    `}templateTokens(){let e=this.assets.filter(e=>e.metadata.name.toLowerCase().includes(this.search.toLowerCase()));return s`
      <wui-flex
        class="contentContainer"
        flexDirection="column"
        .padding=${[`0`,`3`,`0`,`3`]}
      >
        <wui-flex justifyContent="flex-start" .padding=${[`4`,`3`,`3`,`3`]}>
          <wui-text variant="md-medium" color="secondary">Available tokens</wui-text>
        </wui-flex>
        <wui-flex flexDirection="column" gap="2">
          ${e.length>0?e.map(e=>s`<wui-list-item
                    .imageSrc=${e.metadata.iconUrl}
                    ?clickable=${!0}
                    @click=${this.handleTokenClick.bind(this,e)}
                  >
                    <wui-text variant="md-medium" color="primary">${e.metadata.name}</wui-text>
                    <wui-text variant="md-regular" color="secondary"
                      >${e.metadata.symbol}</wui-text
                    >
                  </wui-list-item>`):s`<wui-flex
                .padding=${[`20`,`0`,`0`,`0`]}
                alignItems="center"
                flexDirection="column"
                gap="4"
              >
                <wui-icon-box icon="coinPlaceholder" color="default" size="lg"></wui-icon-box>
                <wui-flex
                  class="textContent"
                  gap="2"
                  flexDirection="column"
                  justifyContent="center"
                >
                  <wui-text variant="lg-medium" align="center" color="primary">
                    No tokens found
                  </wui-text>
                </wui-flex>
                <wui-link @click=${this.onBuyClick.bind(this)}>Buy</wui-link>
              </wui-flex>`}
        </wui-flex>
      </wui-flex>
    `}onBuyClick(){e.push(`OnRampProviders`)}onInputChange(e){this.onDebouncedSearch(e.detail)}handleTokenClick(t){h.setPaymentAsset(t),e.goBack()}};A.styles=O,k([f()],A.prototype,`assets`,void 0),k([f()],A.prototype,`search`,void 0),A=k([p(`w3m-deposit-from-exchange-select-asset-view`)],A);export{A as W3mDepositFromExchangeSelectAssetView,D as W3mDepositFromExchangeView};