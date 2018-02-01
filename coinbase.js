const fs = require('fs');
const Client = require('coinbase').Client;


function waitUntil(gate,cb) {
  if (gate()===true) cb()
  else setTimeout(()=>waitUntil(gate,cb),200)
}

function allCallsCompleted() {
  return callCount<=0;
}


var client = new Client({'apiKey': process.env.COINBASE_API_KEY,
                         'apiSecret': process.env.COINBASE_API_SECRET});

var callCount = 0

var coinbase = {}

function transactionConverter(tx) {
  console.log("***")
  console.log(tx)
  console.log("***")
  return {
    "id": tx.id,
    "timestamp": tx.updated_at,
    "type": tx.type,
    "amount": tx.amount.amount,
    "amountUSD": tx.native_amount.amount,
    "details": tx.details,
    "address": tx.to ? tx.to : tx.from,
    "network": tx.network
  }
}

function buyConverter(tx) {
  return {
    "id": tx.id,
    "timestamp": tx.updated_at,
    "amount": tx.amount.amount,
    "totalUSD": tx.total.amount,
    "subtotalUSD": tx.subtotal.amount
  }
}

function depositConverter(tx) {
  return {
    "id": tx.id,
    "status": tx.status,
    "amount": tx.amount,
    "subtotal": tx.subtotal,
    "fees": tx.fees
  }
}

function getTrans(acct, fnName, fldName, converter) {
  callCount++
  acct[fnName]({}, (err, txs) => {
    if (txs) {
      coinbase[acct.name][fldName] = txs.map((tx) => {
        return converter(tx)
      })
    }
    callCount--
  })
}

function getExchangeData(cb) {
  callCount++
  client.getAccounts({}, (err, accounts) => {
    callCount--
    accounts.forEach((acct) => {
      coinbase[acct.name] = { currency: acct.currency }
      getTrans(acct, "getTransactions", "transactions", transactionConverter)
      getTrans(acct, "getBuys", "buys", buyConverter)
      getTrans(acct, "getSells", "sells", buyConverter)
      getTrans(acct, "getDeposits", "deposits", depositConverter)
      getTrans(acct, "getWithdrawals", "withdrawals", depositConverter)
    })
  })
  setTimeout(()=>waitUntil(allCallsCompleted,()=>{
    cb()
  }),200)
}

function showExchangeData() {
  console.log(JSON.stringify(coinbase,null,2))
}

function saveExchangeDataJSON() {
  fs.writeFile("coinbase_latest.json", JSON.stringify(coinbase,null,2), (err) => {
      if(err) return console.log(err);
      console.log("coinbase exchnage data saved to coinbase_latest.json");
  });
}

function x() {
  let btc = coinbase['BTC Wallet']
  btc.transactions.forEach((tx) => {
    console.log(tx.timestamp, tx.type, tx.amount, tx.amountUSD, tx.details.title, tx.details.subtitle, tx.network)
  })
}

getExchangeData(() => {
  saveExchangeDataJSON()
  x()
})
