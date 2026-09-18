import{t as e}from"./SIWXUtil-DCNJXwmK.js";import{C as t,D as n,V as r,_ as i,l as a,r as o,st as s,x as c,y as l,z as u}from"./ApiController-Buj5l3DN.js";import{_ as d,c as f,f as p,o as m}from"./exports-ClBc5snA.js";import{l as h,o as g}from"./wui-text-CHT8qwsR.js";import"./wui-button-BGnwBRIj.js";import{t as _}from"./ConstantsUtil-C6PF3Ny_.js";import"./wui-link-PMg2t-_z.js";import{t as v}from"./w3m-email-otp-widget-5Ro8-neR.js";import"./wui-icon-box-B_dZs8ZY.js";import{n as y,t as b}from"./ref-D2OL7Eln.js";import"./wui-email-input-UC8AcMHt.js";var x=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},S=class extends v{constructor(){super(...arguments),this.onOtpSubmit=async i=>{try{if(this.authConnector){let r=o.state.activeChain,s=a.getConnections(r),d=u.state.remoteFeatures?.multiWallet,f=s.length>0;if(await this.authConnector.provider.connectOtp({otp:i}),c.sendEvent({type:`track`,event:`EMAIL_VERIFICATION_CODE_PASS`}),r)await a.connectExternal(this.authConnector,r);else throw Error(`Active chain is not set on ChainController`);if(u.state.remoteFeatures?.emailCapture)return;if(u.state.siwx){await e.isAuthenticated()&&l.close();return}if(f&&d){t.replace(`ProfileWallets`),n.showSuccess(`New Wallet Added`);return}l.close()}}catch(e){throw c.sendEvent({type:`track`,event:`EMAIL_VERIFICATION_CODE_FAIL`,properties:{message:r.parseError(e)}}),e}},this.onOtpResend=async e=>{this.authConnector&&(await this.authConnector.provider.connectEmail({email:e}),c.sendEvent({type:`track`,event:`EMAIL_VERIFICATION_CODE_SENT`}))}}};S=x([g(`w3m-email-verify-otp-view`)],S);var C=m`
  wui-icon-box {
    height: ${({spacing:e})=>e[16]};
    width: ${({spacing:e})=>e[16]};
  }
`,w=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},T=class extends f{constructor(){super(),this.email=t.state.data?.email,this.authConnector=i.getAuthConnector(),this.loading=!1,this.listenForDeviceApproval()}render(){if(!this.email)throw Error(`w3m-email-verify-device-view: No email provided`);if(!this.authConnector)throw Error(`w3m-email-verify-device-view: No auth connector provided`);return p`
      <wui-flex
        flexDirection="column"
        alignItems="center"
        .padding=${[`6`,`3`,`6`,`3`]}
        gap="4"
      >
        <wui-icon-box size="xl" color="accent-primary" icon="sealCheck"></wui-icon-box>

        <wui-flex flexDirection="column" alignItems="center" gap="3">
          <wui-flex flexDirection="column" alignItems="center">
            <wui-text variant="md-regular" color="primary">
              Approve the login link we sent to
            </wui-text>
            <wui-text variant="md-regular" color="primary"><b>${this.email}</b></wui-text>
          </wui-flex>

          <wui-text variant="sm-regular" color="secondary" align="center">
            The code expires in 20 minutes
          </wui-text>

          <wui-flex alignItems="center" id="w3m-resend-section" gap="2">
            <wui-text variant="sm-regular" color="primary" align="center">
              Didn't receive it?
            </wui-text>
            <wui-link @click=${this.onResendCode.bind(this)} .disabled=${this.loading}>
              Resend email
            </wui-link>
          </wui-flex>
        </wui-flex>
      </wui-flex>
    `}async listenForDeviceApproval(){if(this.authConnector)try{await this.authConnector.provider.connectDevice(),c.sendEvent({type:`track`,event:`DEVICE_REGISTERED_FOR_EMAIL`}),c.sendEvent({type:`track`,event:`EMAIL_VERIFICATION_CODE_SENT`}),t.replace(`EmailVerifyOtp`,{email:this.email})}catch{t.goBack()}}async onResendCode(){try{if(!this.loading){if(!this.authConnector||!this.email)throw Error(`w3m-email-login-widget: Unable to resend email`);this.loading=!0,await this.authConnector.provider.connectEmail({email:this.email}),this.listenForDeviceApproval(),n.showSuccess(`Code email resent`)}}catch(e){n.showError(e)}finally{this.loading=!1}}};T.styles=C,w([h()],T.prototype,`loading`,void 0),T=w([g(`w3m-email-verify-device-view`)],T);var E=d`
  wui-email-input {
    width: 100%;
  }

  form {
    width: 100%;
    display: block;
    position: relative;
  }
`,D=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},O=class extends f{constructor(){super(...arguments),this.formRef=b(),this.initialEmail=t.state.data?.email??``,this.redirectView=t.state.data?.redirectView,this.email=``,this.loading=!1}firstUpdated(){this.formRef.value?.addEventListener(`keydown`,e=>{e.key===`Enter`&&this.onSubmitEmail(e)})}render(){return p`
      <wui-flex flexDirection="column" padding="4" gap="4">
        <form ${y(this.formRef)} @submit=${this.onSubmitEmail.bind(this)}>
          <wui-email-input
            value=${this.initialEmail}
            .disabled=${this.loading}
            @inputChange=${this.onEmailInputChange.bind(this)}
          >
          </wui-email-input>
          <input type="submit" hidden />
        </form>
        ${this.buttonsTemplate()}
      </wui-flex>
    `}onEmailInputChange(e){this.email=e.detail}async onSubmitEmail(e){try{if(this.loading)return;this.loading=!0,e.preventDefault();let n=i.getAuthConnector();if(!n)throw Error(`w3m-update-email-wallet: Auth connector not found`);let r=await n.provider.updateEmail({email:this.email});c.sendEvent({type:`track`,event:`EMAIL_EDIT`}),r.action===`VERIFY_SECONDARY_OTP`?t.push(`UpdateEmailSecondaryOtp`,{email:this.initialEmail,newEmail:this.email,redirectView:this.redirectView}):t.push(`UpdateEmailPrimaryOtp`,{email:this.initialEmail,newEmail:this.email,redirectView:this.redirectView})}catch(e){n.showError(e),this.loading=!1}}buttonsTemplate(){let e=!this.loading&&this.email.length>3&&this.email!==this.initialEmail;return this.redirectView?p`
      <wui-flex gap="3">
        <wui-button size="md" variant="neutral" fullWidth @click=${t.goBack}>
          Cancel
        </wui-button>

        <wui-button
          size="md"
          variant="accent-primary"
          fullWidth
          @click=${this.onSubmitEmail.bind(this)}
          .disabled=${!e}
          .loading=${this.loading}
        >
          Save
        </wui-button>
      </wui-flex>
    `:p`
        <wui-button
          size="md"
          variant="accent-primary"
          fullWidth
          @click=${this.onSubmitEmail.bind(this)}
          .disabled=${!e}
          .loading=${this.loading}
        >
          Save
        </wui-button>
      `}};O.styles=E,D([h()],O.prototype,`email`,void 0),D([h()],O.prototype,`loading`,void 0),O=D([g(`w3m-update-email-wallet-view`)],O);var k=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},A=class extends v{constructor(){super(),this.email=t.state.data?.email,this.onOtpSubmit=async e=>{try{this.authConnector&&(await this.authConnector.provider.updateEmailPrimaryOtp({otp:e}),c.sendEvent({type:`track`,event:`EMAIL_VERIFICATION_CODE_PASS`}),t.replace(`UpdateEmailSecondaryOtp`,t.state.data))}catch(e){throw c.sendEvent({type:`track`,event:`EMAIL_VERIFICATION_CODE_FAIL`,properties:{message:r.parseError(e)}}),e}},this.onStartOver=()=>{t.replace(`UpdateEmailWallet`,t.state.data)}}};A=k([g(`w3m-update-email-primary-otp-view`)],A);var j=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},M=class extends v{constructor(){super(),this.email=t.state.data?.newEmail,this.redirectView=t.state.data?.redirectView,this.onOtpSubmit=async e=>{try{this.authConnector&&(await this.authConnector.provider.updateEmailSecondaryOtp({otp:e}),c.sendEvent({type:`track`,event:`EMAIL_VERIFICATION_CODE_PASS`}),this.redirectView&&t.reset(this.redirectView))}catch(e){throw c.sendEvent({type:`track`,event:`EMAIL_VERIFICATION_CODE_FAIL`,properties:{message:r.parseError(e)}}),e}},this.onStartOver=()=>{t.replace(`UpdateEmailWallet`,t.state.data)}}};M=j([g(`w3m-update-email-secondary-otp-view`)],M);var N=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},P=class extends f{constructor(){super(),this.authConnector=i.getAuthConnector(),this.isEmailEnabled=u.state.remoteFeatures?.email,this.isAuthEnabled=this.checkIfAuthEnabled(i.state.connectors),this.connectors=i.state.connectors,i.subscribeKey(`connectors`,e=>{this.connectors=e,this.isAuthEnabled=this.checkIfAuthEnabled(this.connectors)})}render(){if(!this.isEmailEnabled)throw Error(`w3m-email-login-view: Email is not enabled`);if(!this.isAuthEnabled)throw Error(`w3m-email-login-view: No auth connector provided`);return p`<wui-flex flexDirection="column" .padding=${[`1`,`3`,`3`,`3`]} gap="4">
      <w3m-email-login-widget></w3m-email-login-widget>
    </wui-flex> `}checkIfAuthEnabled(e){let t=e.filter(e=>e.type===_.CONNECTOR_TYPE_AUTH).map(e=>e.chain);return s.AUTH_CONNECTOR_SUPPORTED_CHAINS.some(e=>t.includes(e))}};N([h()],P.prototype,`connectors`,void 0),P=N([g(`w3m-email-login-view`)],P);export{P as W3mEmailLoginView,v as W3mEmailOtpWidget,T as W3mEmailVerifyDeviceView,S as W3mEmailVerifyOtpView,A as W3mUpdateEmailPrimaryOtpView,M as W3mUpdateEmailSecondaryOtpView,O as W3mUpdateEmailWalletView};