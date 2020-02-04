import React, { Fragment } from 'react'
import PropTypes from 'prop-types'
import helpers, { constants } from 'helpers'
import actions from 'redux/actions'
import Link from 'sw-valuelink'
import { connect } from 'redaction'
import config from 'app-config'

import cssModules from 'react-css-modules'
import styles from '../WithdrawModal/WithdrawModal.scss'

import { BigNumber } from 'bignumber.js'
import Modal from 'components/modal/Modal/Modal'
import FieldLabel from 'components/forms/FieldLabel/FieldLabel'
import Input from 'components/forms/Input/Input'
import Button from 'components/controls/Button/Button'
import Tooltip from 'components/ui/Tooltip/Tooltip'
import { FormattedMessage, injectIntl, defineMessages } from 'react-intl'
import ReactTooltip from 'react-tooltip'
import { isMobile } from 'react-device-detect'
import InvoiceInfoBlock from 'components/InvoiceInfoBlock/InvoiceInfoBlock'

import typeforce from 'swap.app/util/typeforce'
// import { isCoinAddress } from 'swap.app/util/typeforce'
import minAmount from 'helpers/constants/minAmount'
import { inputReplaceCommaWithDot } from 'helpers/domUtils'
import QrReader from "components/QrReader";


@injectIntl
@connect(
  ({
    currencies,
    user: { ethData, btcData, btcMultisigSMSData, bchData, tokensData, nimData, ltcData /* usdtOmniData, nimData */ },
  }) => ({
    currencies: currencies.items,
    items: [ethData, btcData, btcMultisigSMSData, bchData, ltcData /* usdtOmniData, nimData */],
    tokenItems: [...Object.keys(tokensData).map(k => (tokensData[k]))],
  })
)
@cssModules(styles, { allowMultiple: true })
export default class WithdrawModalMultisig extends React.Component {

  static propTypes = {
    name: PropTypes.string,
    data: PropTypes.object,
  }

  constructor(data) {
    super()

    const { data: { amount, toAddress, currency }, items, tokenItems } = data

    const currentDecimals = constants.tokenDecimals.btcmultisig
    const allCurrencyies = items.concat(tokenItems)
    const selectedItem = allCurrencyies.filter(item => item.currency === currency)[0]

    this.state = {
      step: 'fillform',
      isShipped: false,
      address: (toAddress) ? toAddress : '',
      amount: (amount) ? amount : '',
      code: '',
      minus: '',
      balance: selectedItem.balance || 0,
      ethBalance: null,
      isEthToken: helpers.ethToken.isEthToken({ name: currency.toLowerCase() }),
      currentDecimals,
      getUsd: 0,
      error: false,
      smsConfirmed: false,
      ownTx: '',
    }
  }

  componentDidMount() {
    const { exCurrencyRate } = this.state
    const { data: { currency } } = this.props

    this.setBalanceOnState(currency)

    this.usdRates = {}
    this.getUsdBalance()
    this.actualyMinAmount()
  }

  componentWillUpdate(nextProps, nextState) {
    nextState.amount = this.fixDecimalCountETH(nextState.amount)
  }

  fixDecimalCountETH = (amount) => {
    if (this.props.data.currency === 'ETH' && BigNumber(amount).dp() > 18) {
      const amountInt = BigNumber(amount).integerValue()
      const amountDecimal = BigNumber(amount).mod(1)

      const amountIntStr = amountInt.toString()
      const amountDecimalStr = BigNumber(BigNumber(amountDecimal).toPrecision(15)).toString().substring(1)
      const regexr = /[e+-]/g

      const result = amountIntStr + amountDecimalStr

      console.warn("To avoid [ethjs-unit]error: while converting number with more then 18 decimals to wei - you can't afford yourself add more than 18 decimals") // eslint-disable-line
      if (regexr.test(result)) {
        console.warn('And ofcourse you can not write number which can not be saved without an exponential notation in JS')
        return 0
      }
      return result
    }
    return amount
  }

  getMinAmountForEthToken = () => {
    const { data: { currency } } = this.props
    const { currentDecimals } = this.state

    let ethTokenMinAmount = '0.'

    for (let a = 0; a < currentDecimals - 1; a++) {
      ethTokenMinAmount += '0'
    }

    return ethTokenMinAmount += '1'
  }

  actualyMinAmount = async () => {
    const { data: { currency } } = this.props
    const { isEthToken } = this.state

    const currentCoin = currency.toLowerCase()

    if (isEthToken) {
      minAmount[currentCoin] = this.getMinAmountForEthToken()
      minAmount.eth = await helpers.eth.estimateFeeValue({ method: 'send', speed: 'fast' })
    }

    if (constants.coinsWithDynamicFee.includes(currentCoin)) {
      minAmount[currentCoin] = await helpers[currentCoin].estimateFeeValue({ method: 'send', speed: 'fast' })
    }
  }

  setBalanceOnState = async (currency) => {
    const { data: { unconfirmedBalance } } = this.props

    const balance = await actions.btcmultisig.getBalance()

    const finalBalance = unconfirmedBalance !== undefined && unconfirmedBalance < 0
      ? new BigNumber(balance).plus(unconfirmedBalance).toString()
      : balance
    const ethBalance = await actions.eth.getBalance()

    this.setState(() => ({
      balance: finalBalance,
      ethBalance,
    }))
  }

  getUsdBalance = async () => {
    const { data: { currency } } = this.props

    const exCurrencyRate = await actions.user.getExchangeRate(currency, 'usd')

    this.usdRates[currency] = exCurrencyRate

    this.setState(() => ({
      exCurrencyRate,
    }))
  }

  handleConfirmSMS = async () => {
    const { code } = this.state
    const { address: to, amount } = this.state
    const { data: { currency, address, balance, invoice, onReady }, name } = this.props

    const result = await actions.btcmultisig.confirmSMSProtected(code)
    if (result && result.txID) {
      actions.loader.hide()

      if (invoice) {
        await actions.invoices.markInvoice(invoice.id, 'ready', result.txID)
      }

      actions.notifications.show(constants.notifications.SuccessWithdraw, {
        amount,
        currency,
        address: to,
      })

      actions.modals.close(name)
    } else {
      if (result
        && result.error
        && (result.error == 'Fail broadcast')
        && result.rawTX
      ) {
        const resBroatcast = await actions.btcmultisig.broadcastTx(result.rawTX)
        if (invoice) {
          await actions.invoices.markInvoice(invoice.id, 'ready', result.rawTX)
        }
        actions.loader.hide()

        actions.notifications.show(constants.notifications.SuccessWithdraw, {
          amount,
          currency,
          address: to,
        })

        actions.modals.close(name)

        if (onReady instanceof Function) {
          onReady()
        }
      }
    }
  }

  handleSubmit = async () => {
    const { address: to, amount, ownTx } = this.state
    const { data: { currency, address, balance, invoice, onReady }, name } = this.props

    this.setState(() => ({ isShipped: true }))

    this.setBalanceOnState(currency)

    let sendOptions = {
      to,
      amount,
      speed: 'fast',
    }

    if (helpers.ethToken.isEthToken({ name: currency.toLowerCase() })) {
      sendOptions = {
        ...sendOptions,
        name: currency.toLowerCase(),
      }
    } else {
      sendOptions = {
        ...sendOptions,
        from: address,
      }
    }

    if (invoice && ownTx) {
      await actions.invoices.markInvoice(invoice.id, 'ready', ownTx)
      actions.loader.hide()
      actions.notifications.show(constants.notifications.SuccessWithdraw, {
        amount,
        currency,
        address: to,
      })
      this.setState(() => ({ isShipped: false, error: false }))
      actions.modals.close(name)
      if (onReady instanceof Function) {
        onReady()
      }
      return
    }

    const result = await actions.btcmultisig.sendSMSProtected(sendOptions)

    if (result && result.answer === 'ok') {
      this.setState({
        isShipped: false,
        step: 'confirm'
      })
    }
  }

  sellAllBalance = async () => {
    const { amount, balance, currency, isEthToken } = this.state
    const { data } = this.props

    const minFee = minAmount.btc

    const balanceMiner = balance
      ? balance !== 0
        ? new BigNumber(balance).minus(minFee).toString()
        : balance
      : 'Wait please. Loading...'

    this.setState({
      amount: balanceMiner,
    })
  }

  isEthOrERC20() {
    const { name, data, tokenItems } = this.props
    const { currency, ethBalance, isEthToken } = this.state
    return (
      (isEthToken === true && ethBalance < minAmount.eth) ? ethBalance < minAmount.eth : false
    )
  }

    openScan = () => {
    const { openScanCam } = this.state;

  this.setState(() => ({
      openScanCam: !openScanCam
    }));
  };

  handleError = err => {
    console.error(err);
  };

  handleScan = data => {
    if (data) {
      const address = data.split(":")[1].split("?")[0];
      const amount = data.split("=")[1];
      this.setState(() => ({
        address,
        amount
      }));
      this.openScan();
    }
  };

  addressIsCorrect() {
    const { address } = this.state

    return typeforce.isCoinAddress.BTC(address)
  }

  render() {
    const {
      address,
      amount,
      code,
      balance,
      isShipped,
      minus,
      ethBalance,
      exCurrencyRate,
      currentDecimals,
      error,
      openScanCam,
      step,
      ownTx,
    } = this.state

    const {
      name,
      data: {
        currency,
        invoice,
      },
      tokenItems,
      items,
      intl,
    } = this.props

    const linked = Link.all(this, 'address', 'amount', 'code', 'ownTx')

    const min = minAmount.btc
    const dataCurrency = currency.toUpperCase()

    const isDisabled =
      !address || !amount || isShipped || ownTx
      || !this.addressIsCorrect()
      || BigNumber(amount).isGreaterThan(balance)
      || BigNumber(amount).dp() > currentDecimals

    const NanReplacement = balance || '...'
    const getUsd = amount * exCurrencyRate

    if (new BigNumber(amount).isGreaterThan(0)) {
      linked.amount.check((value) => new BigNumber(value).isLessThanOrEqualTo(balance), (
        <div style={{ width: '340px', fontSize: '12px' }}>
          <FormattedMessage
            id="Withdrow170"
            defaultMessage="The amount must be no more than your balance"
            values={{
              min,
              currency: `${currency}`,
            }}
          />
        </div>
      ))
    }

    if (this.state.amount < 0) {
      this.setState({
        amount: '',
        minus: true,
      })
    }

    const labels = defineMessages({
      withdrowModal: {
        id: 'withdrowTitle271',
        defaultMessage: `Send`,
      },
      ownTxPlaceholder: {
        id: 'withdrawOwnTxPlaceholder',
        defaultMessage: 'Если оплатили с другого источника'
      },
      smsPlaceholder: {
        id: 'withdrawSMSCodePlaceholder',
        defaultMessage: 'Enter SMS-code',
      },
    })

    return (
      <Modal name={name} title={`${intl.formatMessage(labels.withdrowModal)}${' '}${currency.toUpperCase()}`}>
        {openScanCam && (
          <QrReader openScan={this.openScan} handleError={this.handleError} handleScan={this.handleScan} />
        )}
        {invoice &&
          <InvoiceInfoBlock invoiceData={invoice} />
        }
        {step === 'fillform' &&
          <Fragment>
            <p styleName="notice">
              <FormattedMessage
                id="Withdrow213"
                defaultMessage="Please note: Fee is {minAmount} {data}.{br}Your balance must exceed this sum to perform transaction"
                values={{ minAmount: `${min}`, br: <br />, data: `${dataCurrency}` }} />
            </p>
            <div styleName="highLevel" style={{ marginBottom: "20px" }}>
              <FieldLabel inRow>
                <span style={{ fontSize: '16px' }}>
                  <FormattedMessage id="Withdrow1194" defaultMessage="Address " />
                </span>
                {' '}
                <Tooltip id="WtH203" >
                  <div style={{ textAlign: 'center' }}>
                    <FormattedMessage
                      id="WTH275"
                      defaultMessage="Make sure the wallet you{br}are sending the funds to supports {currency}"
                      values={{ br: <br />, currency: `${currency.toUpperCase()}` }}
                    />
                  </div>
                </Tooltip>
              </FieldLabel>
              <Input
                valueLink={linked.address}
                focusOnInit
                pattern="0-9a-zA-Z:"
                placeholder={`Enter ${currency.toUpperCase()} address to transfer`}
                qr
                withMargin
                openScan={this.openScan}
              />
              {address && !this.addressIsCorrect() && (
                <div styleName="rednote">
                  <FormattedMessage
                    id="WithdrawIncorectAddress"
                    defaultMessage="Your address not correct" />
                </div>
              )}
            </div>
            <div styleName="lowLevel" style={{ marginBottom: "50px" }}>
              <p styleName="balance">
                {balance} {currency.toUpperCase()}
              </p>
              <FieldLabel>
                <FormattedMessage id="Withdrow118" defaultMessage="Amount " />
              </FieldLabel>

              <div styleName="group">
                <Input
                  styleName="input"
                  valueLink={linked.amount}
                  pattern="0-9\."
                  placeholder="Enter the amount"
                  usd={getUsd.toFixed(2)}
                  onKeyDown={inputReplaceCommaWithDot}
                />
                <div style={{ marginLeft: "15px" }}>
                  <Button blue big onClick={this.sellAllBalance} data-tip data-for="Withdrow134">
                    <FormattedMessage id="Select210" defaultMessage="MAX" />
                  </Button>
                </div>
                {!isMobile && (
                  <ReactTooltip id="Withdrow134" type="light" effect="solid" styleName="r-tooltip">
                    <FormattedMessage
                      id="WithdrawButton32"
                      defaultMessage="when you click this button, in the field, an amount equal to your balance minus the miners commission will appear"
                    />
                  </ReactTooltip>
                )}
                {!linked.amount.error && (
                  <div styleName={minus ? "rednote" : "note"}>
                    <FormattedMessage
                      id="WithdrawModal256"
                      defaultMessage="No less than {minAmount}"
                      values={{ minAmount: `${min}` }}
                    />
                  </div>
                )}
              </div>
            </div>
            <Button styleName="buttonFull" big blue fullWidth disabled={isDisabled} onClick={this.handleSubmit}>
              {isShipped
                ? (
                  <Fragment>
                    <FormattedMessage id="WithdrawModal11212" defaultMessage="Processing ..." />
                  </Fragment>
                )
                : (
                  <Fragment>
                    <FormattedMessage id="WithdrawModal111" defaultMessage="Withdraw" />
                    {' '}
                    {`${currency.toUpperCase()}`}
                  </Fragment>
                )
              }
            </Button>
            {
              error && (
                <div styleName="rednote">
                  <FormattedMessage
                    id="WithdrawModalErrorSend"
                    defaultMessage="{errorName} {currency}:{br}{errorMessage}"
                    values={{
                      errorName: intl.formatMessage(error.name),
                      errorMessage: intl.formatMessage(error.message),
                      br: <br />,
                      currency: `${currency}`,
                    }}
                  />
                </div>
              )
            }
            {invoice && 
              <Fragment>
                <hr />
                <div styleName="lowLevel" style={{ marginBottom: "50px" }}>
                  <div styleName="groupField">
                    <div styleName="downLabel">
                      <FieldLabel inRow>
                        <span styleName="mobileFont">
                          <FormattedMessage id="WithdrowOwnTX" defaultMessage="Или укажите TX" />
                        </span>
                      </FieldLabel>
                    </div>
                  </div>
                  <div styleName="group">
                    <Input
                      styleName="input"
                      valueLink={linked.ownTx}
                      placeholder={`${intl.formatMessage(labels.ownTxPlaceholder)}`}
                    />
                  </div>
                </div>
                <Button styleName="buttonFull" big blue fullWidth disabled={(!(ownTx) || isShipped)} onClick={this.handleSubmit}>
                  {isShipped
                    ? (
                      <Fragment>
                        <FormattedMessage id="WithdrawModal11212" defaultMessage="Processing ..." />
                      </Fragment>
                    )
                    : (
                      <FormattedMessage id="WithdrawModalInvoiceSaveTx" defaultMessage="Отметить как оплаченный" />
                    )
                  }
                </Button>
              </Fragment>
            }
          </Fragment>
        }
        {step === 'confirm' &&
          <Fragment>
            <p styleName="notice">
              <FormattedMessage id="Withdrow2222" defaultMessage="Send SMS code" />
            </p>
            <div styleName="lowLevel">
              <div styleName="groupField">
                <div styleName="downLabel">
                  <FieldLabel inRow>
                    <span styleName="mobileFont">
                      <FormattedMessage id="Withdrow2223" defaultMessage="SMS code" />
                    </span>
                  </FieldLabel>
                </div>
              </div>
              <div styleName="group" style={{ marginBottom: "50px" }}>
                <Input
                  styleName="input"
                  valueLink={linked.code}
                  pattern="0-9"
                  placeholder={`${intl.formatMessage(labels.smsPlaceholder)}`}
                />
              </div>
              <Button styleName="buttonFull" fullWidth big blue onClick={this.handleConfirmSMS}>
                <FormattedMessage id="Withdrow2224" defaultMessage="Confirm" />
              </Button>
              {
                linked.code.error && (
                  <div styleName="rednote error">
                    <FormattedMessage id="WithdrawModal2225" defaultMessage="Something went wrong, enter your current code please" />
                  </div>
                )
              }

            </div>
          </Fragment>
        }
      </Modal>
    )
  }
}
