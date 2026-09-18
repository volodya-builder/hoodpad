import{t as e}from"./SIWXUtil-Dq3ZiCet.js";import{C as t,D as n,H as r,U as i,V as a,_ as o,l as s,r as c,t as l,v as u,x as d,y as f,z as p}from"./ApiController-B6X1n8zJ.js";import{n as m,t as h}from"./ErrorUtil-BzG18tlw.js";import{c as g,f as _,o as v}from"./exports-ClBc5snA.js";import{c as y,l as b,o as x,u as S}from"./wui-text-_J_a5AnU.js";import{t as C}from"./AlertController-C-cDJ6HI.js";import{t as w}from"./wui-loading-thumbnail-Bf9SoZGk.js";import"./wui-button-BfVH6gS4.js";import"./wui-icon-CBKSno1O.js";import{t as T}from"./wui-list-social-C3v2BoH1.js";import"./wui-shimmer-CB72AfIG.js";import"./wui-icon-box-_ACabPew.js";import{t as E}from"./ConstantsUtil-C1qdKpER.js";import"./wui-qr-code-C1pu-wIz.js";var D=v`
  :host {
    margin-top: ${({spacing:e})=>e[1]};
  }
  wui-separator {
    margin: ${({spacing:e})=>e[3]} calc(${({spacing:e})=>e[3]} * -1)
      ${({spacing:e})=>e[2]} calc(${({spacing:e})=>e[3]} * -1);
    width: calc(100% + ${({spacing:e})=>e[3]} * 2);
  }
`,O=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},k=class extends g{constructor(){super(),this.unsubscribe=[],this.tabIdx=void 0,this.connectors=o.state.connectors,this.authConnector=this.connectors.find(e=>e.type===`AUTH`),this.remoteFeatures=p.state.remoteFeatures,this.isPwaLoading=!1,this.hasExceededUsageLimit=l.state.plan.hasExceededUsageLimit,this.unsubscribe.push(o.subscribeKey(`connectors`,e=>{this.connectors=e,this.authConnector=this.connectors.find(e=>e.type===`AUTH`)}),p.subscribeKey(`remoteFeatures`,e=>this.remoteFeatures=e))}connectedCallback(){super.connectedCallback(),this.handlePwaFrameLoad()}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){let e=this.remoteFeatures?.socials||[],n=!!this.authConnector,r=e?.length,a=t.state.view===`ConnectSocials`;return(!n||!r)&&!a?null:(a&&!r&&(e=i.DEFAULT_SOCIALS),_` <wui-flex flexDirection="column" gap="2">
      ${e.map(e=>_`<wui-list-social
            @click=${()=>{this.onSocialClick(e)}}
            data-testid=${`social-selector-${e}`}
            name=${e}
            logo=${e}
            ?disabled=${this.isPwaLoading}
          ></wui-list-social>`)}
    </wui-flex>`)}async onSocialClick(e){if(this.hasExceededUsageLimit){t.push(`UsageExceeded`);return}e&&await T(e)}async handlePwaFrameLoad(){if(a.isPWA()){this.isPwaLoading=!0;try{this.authConnector?.provider instanceof m&&await this.authConnector.provider.init()}catch(e){C.open({displayMessage:`Error loading embedded wallet in PWA`,debugMessage:e.message},`error`)}finally{this.isPwaLoading=!1}}}};k.styles=D,O([S()],k.prototype,`tabIdx`,void 0),O([b()],k.prototype,`connectors`,void 0),O([b()],k.prototype,`authConnector`,void 0),O([b()],k.prototype,`remoteFeatures`,void 0),O([b()],k.prototype,`isPwaLoading`,void 0),O([b()],k.prototype,`hasExceededUsageLimit`,void 0),k=O([x(`w3m-social-login-list`)],k);var A=v`
  wui-flex {
    max-height: clamp(360px, 540px, 80vh);
    overflow: scroll;
    scrollbar-width: none;
    transition: opacity ${({durations:e})=>e.md}
      ${({easings:e})=>e[`ease-out-power-1`]};
    will-change: opacity;
  }

  wui-flex::-webkit-scrollbar {
    display: none;
  }

  wui-flex.disabled {
    opacity: 0.3;
    pointer-events: none;
    user-select: none;
  }
`,j=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},M=class extends g{constructor(){super(),this.unsubscribe=[],this.checked=w.state.isLegalCheckboxChecked,this.unsubscribe.push(w.subscribeKey(`isLegalCheckboxChecked`,e=>{this.checked=e}))}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){let{termsConditionsUrl:e,privacyPolicyUrl:t}=p.state,n=p.state.features?.legalCheckbox,r=!!(e||t)&&!!n&&!this.checked,i=r?-1:void 0;return _`
      <w3m-legal-checkbox></w3m-legal-checkbox>
      <wui-flex
        flexDirection="column"
        .padding=${[`0`,`3`,`3`,`3`]}
        gap="01"
        class=${y(r?`disabled`:void 0)}
      >
        <w3m-social-login-list tabIdx=${y(i)}></w3m-social-login-list>
      </wui-flex>
    `}};M.styles=A,j([b()],M.prototype,`checked`,void 0),M=j([x(`w3m-connect-socials-view`)],M);var N=v`
  wui-logo {
    width: 80px;
    height: 80px;
    border-radius: ${({borderRadius:e})=>e[8]};
  }
  @keyframes shake {
    0% {
      transform: translateX(0);
    }
    25% {
      transform: translateX(3px);
    }
    50% {
      transform: translateX(-3px);
    }
    75% {
      transform: translateX(3px);
    }
    100% {
      transform: translateX(0);
    }
  }
  wui-flex:first-child:not(:only-child) {
    position: relative;
  }
  wui-loading-thumbnail {
    position: absolute;
  }
  wui-icon-box {
    position: absolute;
    right: calc(${({spacing:e})=>e[1]} * -1);
    bottom: calc(${({spacing:e})=>e[1]} * -1);
    opacity: 0;
    transform: scale(0.5);
    transition: all ${({easings:e})=>e[`ease-out-power-2`]}
      ${({durations:e})=>e.lg};
  }
  wui-text[align='center'] {
    width: 100%;
    padding: 0px ${({spacing:e})=>e[4]};
  }
  [data-error='true'] wui-icon-box {
    opacity: 1;
    transform: scale(1);
  }
  [data-error='true'] > wui-flex:first-child {
    animation: shake 250ms ${({easings:e})=>e[`ease-out-power-2`]} both;
  }
  .capitalize {
    text-transform: capitalize;
  }
`,P=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},F=class extends g{constructor(){super(),this.unsubscribe=[],this.socialProvider=c.getAccountData()?.socialProvider,this.socialWindow=c.getAccountData()?.socialWindow,this.error=!1,this.connecting=!1,this.message=`Connect in the provider window`,this.remoteFeatures=p.state.remoteFeatures,this.address=c.getAccountData()?.address,this.connectionsByNamespace=s.getConnections(c.state.activeChain),this.hasMultipleConnections=this.connectionsByNamespace.length>0,this.authConnector=o.getAuthConnector(),this.handleSocialConnection=async e=>{if(e.data?.resultUri)if(e.origin===E.SECURE_SITE_ORIGIN){window.removeEventListener(`message`,this.handleSocialConnection,!1);try{if(this.authConnector&&!this.connecting){this.connecting=!0;let t=this.parseURLError(e.data.resultUri);if(t){this.handleSocialError(t);return}this.closeSocialWindow(),this.updateMessage();let n=e.data.resultUri;this.socialProvider&&d.sendEvent({type:`track`,event:`SOCIAL_LOGIN_REQUEST_USER_DATA`,properties:{provider:this.socialProvider}}),await s.connectExternal({id:this.authConnector.id,type:this.authConnector.type,socialUri:n},this.authConnector.chain),this.socialProvider&&(r.setConnectedSocialProvider(this.socialProvider),d.sendEvent({type:`track`,event:`SOCIAL_LOGIN_SUCCESS`,properties:{provider:this.socialProvider}}))}}catch(e){this.error=!0,this.updateMessage(),this.socialProvider&&d.sendEvent({type:`track`,event:`SOCIAL_LOGIN_ERROR`,properties:{provider:this.socialProvider,message:a.parseError(e)}})}}else t.goBack(),n.showError(`Untrusted Origin`),this.socialProvider&&d.sendEvent({type:`track`,event:`SOCIAL_LOGIN_ERROR`,properties:{provider:this.socialProvider,message:`Untrusted Origin`}})},h.EmbeddedWalletAbortController.signal.addEventListener(`abort`,()=>{this.closeSocialWindow()}),this.unsubscribe.push(c.subscribeChainProp(`accountState`,e=>{if(e&&(this.socialProvider=e.socialProvider,e.socialWindow&&(this.socialWindow=e.socialWindow),e.address)){let r=this.remoteFeatures?.multiWallet;e.address!==this.address&&(this.hasMultipleConnections&&r?(t.replace(`ProfileWallets`),n.showSuccess(`New Wallet Added`),this.address=e.address):(f.state.open||p.state.enableEmbedded)&&f.close())}}),p.subscribeKey(`remoteFeatures`,e=>{this.remoteFeatures=e})),this.authConnector&&this.connectSocial()}disconnectedCallback(){this.unsubscribe.forEach(e=>e()),window.removeEventListener(`message`,this.handleSocialConnection,!1),!c.state.activeCaipAddress&&this.socialProvider&&!this.connecting&&d.sendEvent({type:`track`,event:`SOCIAL_LOGIN_CANCELED`,properties:{provider:this.socialProvider}}),this.closeSocialWindow()}render(){return _`
      <wui-flex
        data-error=${y(this.error)}
        flexDirection="column"
        alignItems="center"
        .padding=${[`10`,`5`,`5`,`5`]}
        gap="6"
      >
        <wui-flex justifyContent="center" alignItems="center">
          <wui-logo logo=${y(this.socialProvider)}></wui-logo>
          ${this.error?null:this.loaderTemplate()}
          <wui-icon-box color="error" icon="close" size="sm"></wui-icon-box>
        </wui-flex>
        <wui-flex flexDirection="column" alignItems="center" gap="2">
          <wui-text align="center" variant="lg-medium" color="primary"
            >Log in with
            <span class="capitalize">${this.socialProvider??`Social`}</span></wui-text
          >
          <wui-text align="center" variant="lg-regular" color=${this.error?`error`:`secondary`}
            >${this.message}</wui-text
          ></wui-flex
        >
      </wui-flex>
    `}loaderTemplate(){let e=u.state.themeVariables[`--w3m-border-radius-master`];return _`<wui-loading-thumbnail radius=${(e?parseInt(e.replace(`px`,``),10):4)*9}></wui-loading-thumbnail>`}parseURLError(e){try{let t=e.indexOf(`error=`);return t===-1?null:e.substring(t+6)}catch{return null}}connectSocial(){let e=setInterval(()=>{this.socialWindow?.closed&&(!this.connecting&&t.state.view===`ConnectingSocial`&&t.goBack(),clearInterval(e))},1e3);window.addEventListener(`message`,this.handleSocialConnection,!1)}updateMessage(){this.error?this.message=`Something went wrong`:this.connecting?this.message=`Retrieving user data`:this.message=`Connect in the provider window`}handleSocialError(e){this.error=!0,this.updateMessage(),this.socialProvider&&d.sendEvent({type:`track`,event:`SOCIAL_LOGIN_ERROR`,properties:{provider:this.socialProvider,message:e}}),this.closeSocialWindow()}closeSocialWindow(){this.socialWindow&&(this.socialWindow.close(),c.setAccountProp(`socialWindow`,void 0,c.state.activeChain))}};F.styles=N,P([b()],F.prototype,`socialProvider`,void 0),P([b()],F.prototype,`socialWindow`,void 0),P([b()],F.prototype,`error`,void 0),P([b()],F.prototype,`connecting`,void 0),P([b()],F.prototype,`message`,void 0),P([b()],F.prototype,`remoteFeatures`,void 0),F=P([x(`w3m-connecting-social-view`)],F);var I=v`
  wui-shimmer {
    width: 100%;
    aspect-ratio: 1 / 1;
    border-radius: ${({borderRadius:e})=>e[4]};
  }

  wui-qr-code {
    opacity: 0;
    animation-duration: ${({durations:e})=>e.xl};
    animation-timing-function: ${({easings:e})=>e[`ease-out-power-2`]};
    animation-name: fade-in;
    animation-fill-mode: forwards;
  }

  wui-logo {
    width: 80px;
    height: 80px;
    border-radius: ${({borderRadius:e})=>e[8]};
  }

  wui-flex:first-child:not(:only-child) {
    position: relative;
  }

  wui-loading-thumbnail {
    position: absolute;
  }

  wui-icon-box {
    position: absolute;
    right: calc(${({spacing:e})=>e[1]} * -1);
    bottom: calc(${({spacing:e})=>e[1]} * -1);
    opacity: 0;
    transform: scale(0.5);
    transition:
      opacity ${({durations:e})=>e.lg} ${({easings:e})=>e[`ease-out-power-2`]},
      transform ${({durations:e})=>e.lg}
        ${({easings:e})=>e[`ease-out-power-2`]};
    will-change: opacity, transform;
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
`,L=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},R=class extends g{constructor(){super(),this.unsubscribe=[],this.timeout=void 0,this.socialProvider=c.getAccountData()?.socialProvider,this.uri=c.getAccountData()?.farcasterUrl,this.ready=!1,this.loading=!1,this.remoteFeatures=p.state.remoteFeatures,this.authConnector=o.getAuthConnector(),this.forceUpdate=()=>{this.requestUpdate()},this.unsubscribe.push(c.subscribeChainProp(`accountState`,e=>{this.socialProvider=e?.socialProvider,this.uri=e?.farcasterUrl,this.connectFarcaster()}),p.subscribeKey(`remoteFeatures`,e=>{this.remoteFeatures=e})),window.addEventListener(`resize`,this.forceUpdate)}disconnectedCallback(){super.disconnectedCallback(),clearTimeout(this.timeout),window.removeEventListener(`resize`,this.forceUpdate),!c.state.activeCaipAddress&&this.socialProvider&&(this.uri||this.loading)&&d.sendEvent({type:`track`,event:`SOCIAL_LOGIN_CANCELED`,properties:{provider:this.socialProvider}})}render(){return this.onRenderProxy(),_`${this.platformTemplate()}`}platformTemplate(){return a.isMobile()?_`${this.mobileTemplate()}`:_`${this.desktopTemplate()}`}desktopTemplate(){return this.loading?_`${this.loadingTemplate()}`:_`${this.qrTemplate()}`}qrTemplate(){return _` <wui-flex
      flexDirection="column"
      alignItems="center"
      .padding=${[`0`,`5`,`5`,`5`]}
      gap="5"
    >
      <wui-shimmer width="100%"> ${this.qrCodeTemplate()} </wui-shimmer>

      <wui-text variant="lg-medium" color="primary"> Scan this QR Code with your phone </wui-text>
      ${this.copyTemplate()}
    </wui-flex>`}loadingTemplate(){return _`
      <wui-flex
        flexDirection="column"
        alignItems="center"
        .padding=${[`5`,`5`,`5`,`5`]}
        gap="5"
      >
        <wui-flex justifyContent="center" alignItems="center">
          <wui-logo logo="farcaster"></wui-logo>
          ${this.loaderTemplate()}
          <wui-icon-box color="error" icon="close" size="sm"></wui-icon-box>
        </wui-flex>
        <wui-flex flexDirection="column" alignItems="center" gap="2">
          <wui-text align="center" variant="md-medium" color="primary">
            Loading user data
          </wui-text>
          <wui-text align="center" variant="sm-regular" color="secondary">
            Please wait a moment while we load your data.
          </wui-text>
        </wui-flex>
      </wui-flex>
    `}mobileTemplate(){return _` <wui-flex
      flexDirection="column"
      alignItems="center"
      .padding=${[`10`,`5`,`5`,`5`]}
      gap="5"
    >
      <wui-flex justifyContent="center" alignItems="center">
        <wui-logo logo="farcaster"></wui-logo>
        ${this.loaderTemplate()}
        <wui-icon-box
          color="error"
          icon="close"
          size="sm"
        ></wui-icon-box>
      </wui-flex>
      <wui-flex flexDirection="column" alignItems="center" gap="2">
        <wui-text align="center" variant="md-medium" color="primary"
          >Continue in Farcaster</span></wui-text
        >
        <wui-text align="center" variant="sm-regular" color="secondary"
          >Accept connection request in the app</wui-text
        ></wui-flex
      >
      ${this.mobileLinkTemplate()}
    </wui-flex>`}loaderTemplate(){let e=u.state.themeVariables[`--w3m-border-radius-master`];return _`<wui-loading-thumbnail radius=${(e?parseInt(e.replace(`px`,``),10):4)*9}></wui-loading-thumbnail>`}async connectFarcaster(){if(this.authConnector)try{await this.authConnector?.provider.connectFarcaster(),this.socialProvider&&(r.setConnectedSocialProvider(this.socialProvider),d.sendEvent({type:`track`,event:`SOCIAL_LOGIN_REQUEST_USER_DATA`,properties:{provider:this.socialProvider}})),this.loading=!0;let i=s.getConnections(this.authConnector.chain).length>0;await s.connectExternal(this.authConnector,this.authConnector.chain);let a=this.remoteFeatures?.multiWallet;this.socialProvider&&d.sendEvent({type:`track`,event:`SOCIAL_LOGIN_SUCCESS`,properties:{provider:this.socialProvider}}),this.loading=!1,(!p.state.siwx||await e.isAuthenticated())&&(i&&a?(t.replace(`ProfileWallets`),n.showSuccess(`New Wallet Added`)):f.close())}catch(e){this.socialProvider&&d.sendEvent({type:`track`,event:`SOCIAL_LOGIN_ERROR`,properties:{provider:this.socialProvider,message:a.parseError(e)}}),t.goBack(),n.showError(e)}}mobileLinkTemplate(){return _`<wui-button
      size="md"
      ?loading=${this.loading}
      ?disabled=${!this.uri||this.loading}
      @click=${()=>{this.uri&&a.openHref(this.uri,`_blank`)}}
    >
      Open farcaster</wui-button
    >`}onRenderProxy(){!this.ready&&this.uri&&(this.timeout=setTimeout(()=>{this.ready=!0},200))}qrCodeTemplate(){if(!this.uri||!this.ready)return null;let e=this.getBoundingClientRect().width-40,t=u.state.themeVariables[`--apkt-qr-color`]??u.state.themeVariables[`--w3m-qr-color`];return _` <wui-qr-code
      size=${e}
      theme=${u.state.themeMode}
      uri=${this.uri}
      ?farcaster=${!0}
      data-testid="wui-qr-code"
      color=${y(t)}
    ></wui-qr-code>`}copyTemplate(){return _`<wui-button
      .disabled=${!this.uri||!this.ready}
      @click=${this.onCopyUri}
      variant="neutral-secondary"
      size="sm"
      data-testid="copy-wc2-uri"
    >
      <wui-icon size="sm" color="default" slot="iconRight" name="copy"></wui-icon>
      Copy link
    </wui-button>`}onCopyUri(){try{this.uri&&(a.copyToClopboard(this.uri),n.showSuccess(`Link copied`))}catch{n.showError(`Failed to copy`)}}};R.styles=I,L([b()],R.prototype,`socialProvider`,void 0),L([b()],R.prototype,`uri`,void 0),L([b()],R.prototype,`ready`,void 0),L([b()],R.prototype,`loading`,void 0),L([b()],R.prototype,`remoteFeatures`,void 0),R=L([x(`w3m-connecting-farcaster-view`)],R);export{M as W3mConnectSocialsView,R as W3mConnectingFarcasterView,F as W3mConnectingSocialView};