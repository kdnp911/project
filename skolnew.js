const { initializeApp, applicationDefault, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');
const Binance = require('binance-api-node').default
const cors = require("cors");
var express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const crypto = require('crypto');
// const fetch = require("node-fetch");
var app = express();
app.use(cors());
// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));
const http = require('http'); 
// parse application/json
app.use(bodyParser.json());
// app.use(cors({
//   origin: '*',
//   allowedHeaders: 'X-Requested-With, Content-Type, auth-token,Access-Control-Allow-Origin',
// }));

const admin = require("firebase-admin");
const db = require("./db");
const {WebsocketClient} = require("binance");
const { default: binanceApiNode, NewOrderRespType, OrderType, FuturesIncomeType } = require('binance-api-node');
app.post('/proxy', (req, res) => {
  try{
  const { url, method, headers, body } = req.body;

  // Define the options for the outgoing request
  const options = {
      method,
      headers,
      body,
  };

  // Make the outgoing request
  const proxyRequest = http.request(url, options, (proxyResponse) => {
      let responseData = '';

      // A chunk of data has been received.
      proxyResponse.on('data', (chunk) => {
          responseData += chunk;
      });

      // The whole response has been received. Send it back to the client.
      proxyResponse.on('end', () => {
          res.send(responseData);
      });
  });

  // Handle errors in the outgoing request
  proxyRequest.on('error', (e) => {
      console.error(`Error in proxy request: ${e.message}`);
      res.status(500).send('Internal Server Error');
  });

  // Send the body if it exists
  if (body) {
      proxyRequest.write(body);
  }

  // End the request
  proxyRequest.end();
}
catch(err){
  console.log("error in whole block :"+err);
  res.status(500).send('Internal Server Error');
  
}
});

async function cancelOrder(parentOrderId){
try{
  
  const orders = await admin.firestore().collection("childOrder").where("parentOrderId", "==", parentOrderId).get();
  if (orders.docs.length>0) {
    orders.docs.forEach(async (doc) =>{
      const api = doc.data().api_key;
      const secret = doc.data().api_secret;
      const binance =Binance({
        apiKey:api,
        apiSecret:secret,
        // wsBase:process.env.ws_base
      });
     binance.futuresCancelOrder({
      symbol:doc.data().symbol,
      orderId:doc.data().orderId,
    
     }).then((data)=>{
      data.orderId=data.orderId.toString();
      db.collection("futuresCancelOrders").add(data).catch((error)=>{
        console.log("futuresCancelOrders error:  "+error);
       });
          
     }).catch((error)=>{
      console.log("error:  "+error);
     });
    });
  }
}
catch(err){
  console.log("error in cancel order :"+err);
}
}
async function closeOrder(parentOrderId){
try{
  
  const orders = await admin.firestore().collection("childOrder").where("parentOrderId", "==", parentOrderId).where("closed", "==", false).get();
  if (orders.docs.length>0) {
    orders.docs.forEach(async (doc) =>{
      const api = doc.data().api_key;
      const secret = doc.data().api_secret;
      const binance =Binance({
        apiKey:api,
        apiSecret:secret
      });
      let side ="SELL";
      if(doc.data().side=="SELL"){
        side ="BUY";
      }
      // binance.futures
      binance.futuresOrder({
        symbol:doc.data().symbol,
        side:side,
        type:"MARKET",
        quantity:doc.data().quantity,  
        recvWindow:50000,   
        reduceOnly:true,
        
      })
          .then((data) => {
            doc.ref.update({
              'closed':true
            });
            })
            .catch((error) => {
              doc.ref.update({
                'closed':true
              });
              console.error("close orderError saving order:"+error);         
            
            });
   
    });
  }
}
catch(err){
  console.log("error in close order :"+err);
}
}

Number.prototype.countDecimals = function () {
  if (Math.floor(this.valueOf()) === this.valueOf()) return 0;

  var str = this.toString();
  if (str.indexOf(".") !== -1 && str.indexOf("-") !== -1) {
      return str.split("-")[1] || 0;
  } else if (str.indexOf(".") !== -1) {
      return str.split(".")[1].length || 0;
  }
  return str.split("-")[1] || 0;
}
async function placeOrder(od,traderBalance,trader){
  console.log("trader balance :"+traderBalance);
  console.log("trader is :"+trader);
  try{
  let allocation =od.order.originalQuantity/traderBalance;
  const settings = await admin.firestore().collection("settings").doc("settings").get();
  const minimumBalance =settings.data().minimumBalance;
  const copy = settings.data()[`copy_${trader}`];
  const copyUsers = settings.data()[`copyUsers_${trader}`];
  console.log("minimum balance :"+minimumBalance);
  const query = copy
  ? admin.firestore().collection("users").where("email", "in", copyUsers)
  : admin.firestore().collection("users").where("follows", "array-contains", trader);

const users = await query.get();
  if (users.docs.length>0) {
    users.docs.forEach(async (doc) =>{
      const api = doc.data().api_key;
      const secret = doc.data().api_secret;
      const follows = doc.data().follows;
      const followsLength=follows.length;
      let balance =0;
      console.log("user is:"+doc.data().email);
      try{

      const binance =Binance({
        apiKey:api,
        apiSecret:secret
      });
      let array1 = [];
      let orderQty=od.order.originalQuantity;
      
      // await binance.futuresLeverage({
      //   symbol: od.order.symbol,
      //   leverage: doc.data().leverage,
      // }).then((data)=>{
    
      // }).catch((error) => {
        
      //   console.error("allOrdersError saving order:"+error);
      //   console.log("user  :"+doc.data().email);
      
       
      // });
      binance.futuresAccountBalance().then(async (balance)=>{
    
   
     for(var i=0;i<balance.length;i++){
      var element=balance[i];
      array1.push(element);
      if(od.order.symbol.lastIndexOf(element.asset)>1 && (element.balance!=0||element.asset=="USDT")){
        balance=element.balance;
        orderQty=allocation*element.balance*doc.data().allocation/(100*followsLength);
        console.log(element.asset);
        console.log(traderBalance);
        console.log(allocation);
        console.log(element.balance);
        console.log(doc.data().allocation);
        console.log(doc.data().email);
        console.log(orderQty);
        console.log("finish");
        break;
      }
     }

    let precision=8;
    let pricePrecision=8;
    precision=od.order.originalQuantity.countDecimals();
  // await binance.exchangeInfo({
  //   symbol:od.order.symbol.split("_")[0]
  //  }).then((data)=>{
  //   db.collection("exchangeInfo").doc(od.order.symbol).set(data);
    

   
  //  }).catch((error) => {
  //      console.log(od.order.symbol);
  //   console.error("exchangeInfoError saving order:"+error);
    
   
  // });
     if(precision<0){
precision=0;
     }
      let array2 = [];
      console.log("precise value");
      console.log(precision);
    console.log(orderQty.toFixed(precision));

      if(balance<minimumBalance){
        console.error("minimum balance:"+balance);
        console.log("user  :"+doc.data().email);
      }
      else if(od.order.stopPrice==0 && od.order.orderType!="MARKET"){
      
       console.log("not market");
       
      binance.futuresOrder({
        symbol:od.order.symbol,
        side:od.order.orderSide,
        type:od.order.orderType,
        quantity:orderQty.toFixed(precision),        
        price:od.order.originalPrice,   
        recvWindow:50000,
        reduceOnly:od.order.isReduceOnly,
              
        
      })
          .then((data) => {
           
            db.collection("childOrder").add({
              "symbol":od.order.symbol,
            "side":od.order.orderSide,
            "type":od.order.orderType,
            "quantity":orderQty.toFixed(precision), 
            "price":od.order.originalPrice,
            "orderId":data.orderId.toString(),
            "parentOrderId":od.order.orderId.toString(),
            "api_key":api,
            "api_secret":secret,
            "time":FieldValue.serverTimestamp(),
            'closed':false,
            "reduceOnly":od.order.isReduceOnly,
            "userId":doc.data().uid.toString(),
            
            }).catch((error)=>{
              console.error("childOrder firebase saving order:"+error);
            });
            })
            .catch((error) => {
              console.log("first order error:"+error);
              console.log("user  :"+doc.data().email);
              // if(error.toString().includes("ReduceOnly Order is rejected")){
              //   od.order.isReduceOnly=false;
              // }
              // else
               if(precision>0 ){
                precision=precision-1;
              }
              binance.futuresOrder({
                symbol:od.order.symbol,
                side:od.order.orderSide,
                type:od.order.orderType,
                quantity:orderQty.toFixed(precision),        
                price:od.order.originalPrice,   
                recvWindow:50000,
                reduceOnly:od.order.isReduceOnly,
                      
                
              })
                  .then((data) => {
                    db.collection("childOrder").add({
                      "symbol":od.order.symbol,
                    "side":od.order.orderSide,
                    "type":od.order.orderType,
                    "quantity":orderQty.toFixed(precision-1), 
                    "price":od.order.originalPrice,
                    "orderId":data.orderId.toString(),
                    "parentOrderId":od.order.orderId.toString(),
                    "api_key":api,
                    "api_secret":secret,
                    "time":FieldValue.serverTimestamp(),
                    'closed':false,
                    "reduceOnly":od.order.isReduceOnly,
                    "userId":doc.data().uid.toString(),
                    
                    }).catch((error)=>{
                      console.error("childOrder firebase saving order:"+error);
                    });
                    })
                    .catch((error) => {
                      if(error.toString().includes("ReduceOnly Order is rejected")){
                        reduceOnly(api,secret,od.order.symbol,od.order.orderType,od.order.orderSide,od.order.originalPrice,od.order.stopPrice,precision,orderQty.toFixed(precision));
                      }
                     
                      console.log(orderQty.toFixed(precision));
                      console.log(precision);
                      console.error("allOrdersError2 saving order:"+error);
                      console.log("user  :"+doc.data().email);
                     
                    });
                  
             
            });
      
          }
          else if(od.order.orderType=="MARKET"){
           
            console.log("market");
           
          binance.futuresOrder({
            symbol:od.order.symbol,
            side:od.order.orderSide,
            type:od.order.orderType,
            quantity:orderQty.toFixed(precision),        
            recvWindow:50000,
            reduceOnly:od.order.isReduceOnly,
                  
            
          })
              .then((data) => {
                db.collection("childOrder").add({
                  "symbol":od.order.symbol,
                "side":od.order.orderSide,
                "type":od.order.orderType,
                "quantity":orderQty.toFixed(precision), 
                "orderId":data.orderId.toString(),
                "parentOrderId":od.order.orderId.toString(),
                "api_key":api,
                  "api_secret":secret,
                  "time":FieldValue.serverTimestamp(),
                  'closed':false,
                  "reduceOnly":od.order.isReduceOnly,
                  "userId":doc.data().uid.toString(),
                }).catch((error)=>{
                  console.error("childOrder firebase saving order:"+error);
                });
                })
                .catch((error) => {
                  console.log("first order error:"+error);
                  console.log("user  :"+doc.data().email);
                  if( error.toString().includes("Quantity less than") ){
                    quantityLessThan(api,secret,{
                      symbol:od.order.symbol,
                      side:od.order.orderSide,
                      type:od.order.orderType,
                      quantity:orderQty.toFixed(precision),        
                      recvWindow:50000,
                      reduceOnly:od.order.isReduceOnly,
                            
                      
                    },precision,{
                      "symbol":od.order.symbol,
                    "side":od.order.orderSide,
                    "type":od.order.orderType,
                    "quantity":orderQty.toFixed(precision), 
                    "orderId":od.order.orderId.toString(),
                    "parentOrderId":od.order.orderId.toString(),
                    "api_key":api,
                      "api_secret":secret,
                      "time":FieldValue.serverTimestamp(),
                      'closed':false,
                      "reduceOnly":od.order.isReduceOnly,
                      "userId":doc.data().uid.toString(),
                    },orderQty,doc.data().email);
              
                  }
                //  else if(error.toString().includes("ReduceOnly Order is rejected")){
                //     od.order.isReduceOnly=false;
                //   }
                  
                  else if(precision>0){
                    precision=precision-1;
                  }
                  if( !error.toString().includes("Quantity less than")){
                  binance.futuresOrder({
                    symbol:od.order.symbol,
                    side:od.order.orderSide,
                    type:od.order.orderType,
                    quantity:orderQty.toFixed(precision),        
                    recvWindow:50000,
                    reduceOnly:od.order.isReduceOnly,
                          
                    
                  })
                      .then((data) => {
                        db.collection("childOrder").add({
                          "symbol":od.order.symbol,
                        "side":od.order.orderSide,
                        "type":od.order.orderType,
                        "quantity":orderQty.toFixed(precision), 
                        "orderId":data.orderId.toString(),
                        "parentOrderId":od.order.orderId.toString(),
                        "api_key":api,
                          "api_secret":secret,
                          "time":FieldValue.serverTimestamp(),
                          'closed':false,
                          "reduceOnly":od.order.isReduceOnly,
                          "userId":doc.data().uid.toString(),
                        }).catch((error)=>{
                          console.error("childOrder firebase saving order:"+error);
                        });
                        })
                        .catch((error) => {
                          if(error.toString().includes("ReduceOnly Order is rejected")){
                            reduceOnly(api,secret,od.order.symbol,od.order.orderType,od.order.orderSide,od.order.originalPrice,od.order.stopPrice,precision,orderQty.toFixed(precision));
                          }
                          console.log(orderQty.toFixed(precision));
                          console.log(precision);
                          console.error("allOrdersError2 saving order:"+error);
                          console.log("user  :"+doc.data().email);
                        
                
                        });
                      }
                
        
                });
              }
              else if(od.order.stopPrice!=0 && od.order.orderType=="STOP_MARKET" &&od.order.isCloseAll==false){
              
              console.log("hereeeeee stop market order");
                 console.log("reduceOnly:"+od.order.isReduceOnly);
                binance.futuresOrder({
                  symbol:od.order.symbol,
                  side:od.order.orderSide,
                  type:od.order.orderType,
                  quantity:orderQty.toFixed(precision),
                  stopPrice:od.order.stopPrice,   
                  reduceOnly:od.order.isReduceOnly,
                  workingType:od.order.stopPriceWorkingType,
                  recvWindow:50000,
                  
                  
                }).then((data) => {
                  console.log("stop market success");
                      db.collection("childOrder").add({
                        "symbol":od.order.symbol,
                      "side":od.order.orderSide,
                      "type":od.order.orderType,
                      "quantity":orderQty.toFixed(precision), 
                      "orderId":data.orderId.toString(),
                      "parentOrderId":od.order.orderId.toString(),
                      "api_key":api,
                        "api_secret":secret,
                        "time":FieldValue.serverTimestamp(),
                        'closed':false,
                        "reduceOnly":od.order.isReduceOnly,
                        "userId":doc.data().uid.toString(),
                      }).catch((error)=>{
                        console.error("childOrder firebase saving order:"+error);
                      });
                      })
                      .catch((error) => {
                        console.log("first order error:"+error);
                        console.log("user  :"+doc.data().email);
                        if( error.toString().includes("Quantity less than")){
                          quantityLessThan(api,secret,{
                            symbol:od.order.symbol,
                            side:od.order.orderSide,
                            type:od.order.orderType,
                            quantity:orderQty.toFixed(precision),
                            stopPrice:od.order.stopPrice,   
                            reduceOnly:od.order.isReduceOnly,
                            workingType:od.order.stopPriceWorkingType,
                            recvWindow:50000,
                            
                          },precision,{
                            "symbol":od.order.symbol,
                          "side":od.order.orderSide,
                          "type":od.order.orderType,
                          "quantity":orderQty.toFixed(precision), 
                          "orderId":od.order.orderId.toString(),
                          "parentOrderId":od.order.orderId.toString(),
                          "api_key":api,
                            "api_secret":secret,
                            "time":FieldValue.serverTimestamp(),
                            'closed':false,
                            "reduceOnly":od.order.isReduceOnly,
                            "userId":doc.data().uid.toString(),
                          },orderQty,doc.data().email);
                    
                        }
                      //  else if(error.toString().includes("ReduceOnly Order is rejected")){
                      //     od.order.isReduceOnly=false;
                      //   }
                        
                        else  if(precision>0){
                          precision=precision-1;
                        }
                        if( !error.toString().includes("Quantity less than")){
                        binance.futuresOrder({
                          symbol:od.order.symbol,
                          side:od.order.orderSide,
                          type:od.order.orderType,
                          quantity:orderQty.toFixed(precision),
                          stopPrice:od.order.stopPrice,   
                          reduceOnly:od.order.isReduceOnly,
                          workingType:od.order.stopPriceWorkingType,
                          recvWindow:50000,
                          
                        }).then((data) => {
                          console.log("stop market again success");
                              db.collection("childOrder").add({
                                "symbol":od.order.symbol,
                              "side":od.order.orderSide,
                              "type":od.order.orderType,
                              "quantity":orderQty.toFixed(precision), 
                              "orderId":data.orderId.toString(),
                              "parentOrderId":od.order.orderId.toString(),
                              "api_key":api,
                                "api_secret":secret,
                                "time":FieldValue.serverTimestamp(),
                                'closed':false,
                                "reduceOnly":od.order.isReduceOnly,
                                "userId":doc.data().uid.toString(),
                              }).catch((error)=>{
                                console.error("childOrder firebase saving order:"+error);
                              });
                              })
                              .catch((error) => {
                                if(error.toString().includes("ReduceOnly Order is rejected")){
                                  reduceOnly(api,secret,od.order.symbol,od.order.orderType,od.order.orderSide,od.order.originalPrice,od.order.stopPrice,precision,orderQty.toFixed(precision));
                                }
                                console.log(orderQty.toFixed(precision));
                                console.log(precision);
                                console.error("allOrdersError2 saving order:"+error);
                                console.log("user  :"+doc.data().email);
                              
                              });
                            }
                      
                      });
             
            
              
                  }
                  else if(od.order.stopPrice!=0 && (od.order.orderType=="STOP_MARKET" ||od.order.orderType=="TAKE_PROFIT_MARKET") &&od.order.isCloseAll==true){
                     console.log("take profit");
                     console.log(orderQty.toFixed(precision));
                    binance.futuresOrder({
                      symbol:od.order.symbol,
                      side:od.order.orderSide,
                      type:od.order.orderType,
                      quantity:orderQty.toFixed(precision),
                      
                      stopPrice:od.order.stopPrice,                      
                      closePosition:od.order.isCloseAll,
                      
                            
                      
                    })
                        .then((data) => {
                          db.collection("childOrder").add({
                            "symbol":od.order.symbol,
                          "side":od.order.orderSide,
                          "type":od.order.orderType,
                          "quantity":orderQty.toFixed(precision), 
                          "price":od.order.originalPrice,
                          "stopPrice":od.order.stopPrice,
                          "orderId":data.orderId.toString(),
                          "parentOrderId":od.order.orderId.toString(),
                          "api_key":api,
                          "api_secret":secret,
                          "time":FieldValue.serverTimestamp(),
                          'closed':false,
                          "reduceOnly":od.order.isReduceOnly,
                          "userId":doc.data().uid.toString(),
                          }).catch((error)=>{
                            console.error("childOrder firebase saving order:"+error);
                          });
                          })
                          .catch((error) => {
                            console.log("first order error:"+error);
                            console.log("user  :"+doc.data().email);
                            if( error.toString().includes("Quantity less than")){
                              quantityLessThan(api,secret,{
                                symbol:od.order.symbol,
                                side:od.order.orderSide,
                                type:od.order.orderType,
                                quantity:orderQty.toFixed(precision),
                                price:od.order.originalPrice,
                                stopPrice:od.order.stopPrice,
                                reduceOnly:od.order.isReduceOnly,
                                      
                                
                              },precision,{
                                "symbol":od.order.symbol,
                              "side":od.order.orderSide,
                              "type":od.order.orderType,
                              "quantity":orderQty.toFixed(precision), 
                              "orderId":od.order.orderId.toString(),
                              "parentOrderId":od.order.orderId.toString(),
                              "api_key":api,
                                "api_secret":secret,
                                "time":FieldValue.serverTimestamp(),
                                'closed':false,
                                "reduceOnly":od.order.isReduceOnly,
                                "userId":doc.data().uid.toString(),
                              },orderQty,doc.data().email);
                        
                            }
                            // else if(error.toString().includes("ReduceOnly Order is rejected")){
                            //   od.order.isReduceOnly=false;
                            // }
                            else if(precision>0){
                              precision=precision-1;
                            }
                            if( !error.toString().includes("Quantity less than")){
                            binance.futuresOrder({
                             symbol:od.order.symbol,
                      side:od.order.orderSide,
                      type:od.order.orderType,
                      quantity:orderQty.toFixed(precision),
                      
                      stopPrice:od.order.stopPrice,                      
                      closePosition:od.order.isCloseAll,
                              
                                    
                              
                            })
                                .then((data) => {
                                  db.collection("childOrder").add({
                                    "symbol":od.order.symbol,
                                  "side":od.order.orderSide,
                                  "type":od.order.orderType,
                                  "quantity":orderQty.toFixed(precision), 
                                  "price":od.order.originalPrice,
                                  "stopPrice":od.order.stopPrice,
                                  "orderId":data.orderId.toString(),
                                  "parentOrderId":od.order.orderId.toString(),
                                  "api_key":api,
                                  "api_secret":secret,
                                  "time":FieldValue.serverTimestamp(),
                                  'closed':false,
                                  "reduceOnly":od.order.isReduceOnly,
                                  "userId":doc.data().uid.toString(),
                                  }).catch((error)=>{
                                    console.error("childOrder firebase saving order:"+error);
                                  });
                                  })
                                  .catch((error) => {
                                    if(error.toString().includes("ReduceOnly Order is rejected")){
                                      reduceOnly(api,secret,od.order.symbol,od.order.orderType,od.order.orderSide,od.order.originalPrice,od.order.stopPrice,precision,orderQty.toFixed(precision));
                                    }
                                    console.log(orderQty.toFixed(precision));
                                    console.log(precision);
                                    console.error("allOrdersError2 saving order:"+error);
                                    console.log("user  :"+doc.data().email);
                                    
                                  });
                                }
                            
                          });
                  
                    
                  }
          else{
            console.log("elseeee");
          console.log(od.order.orderType);
          console.log(od.order.isCloseAll);
            binance.futuresOrder({
              symbol:od.order.symbol,
              side:od.order.orderSide,
              type:od.order.orderType,
              quantity:orderQty.toFixed(precision),
              price:od.order.originalPrice,
              stopPrice:od.order.stopPrice,
              reduceOnly:od.order.isReduceOnly,
              closePosition:od.order.isCloseAll,
              
                    
              
            })
                .then((data) => {
                  db.collection("childOrder").add({
                    "symbol":od.order.symbol,
                  "side":od.order.orderSide,
                  "type":od.order.orderType,
                  "quantity":orderQty.toFixed(precision), 
                  "price":od.order.originalPrice,
                  "stopPrice":od.order.stopPrice,
                  "orderId":data.orderId.toString(),
                  "parentOrderId":od.order.orderId.toString(),
                  "api_key":api,
                  "api_secret":secret,
                  "time":FieldValue.serverTimestamp(),
                  'closed':false,
                  "reduceOnly":od.order.isReduceOnly,
                  "userId":doc.data().uid.toString(),
                  }).catch((error)=>{
                    console.error("childOrder firebase saving order:"+error);
                  });
                  })
                  .catch((error) => {
                    console.log("first order error:"+error);
                    console.log("user  :"+doc.data().email);
                    if( error.toString().includes("Quantity less than")){
                      quantityLessThan(api,secret,{
                        symbol:od.order.symbol,
                        side:od.order.orderSide,
                        type:od.order.orderType,
                        quantity:orderQty.toFixed(precision),
                        price:od.order.originalPrice,
                        stopPrice:od.order.stopPrice,
                        reduceOnly:od.order.isReduceOnly,
                              
                        
                      },precision,{
                        "symbol":od.order.symbol,
                      "side":od.order.orderSide,
                      "type":od.order.orderType,
                      "quantity":orderQty.toFixed(precision), 
                      "orderId":od.order.orderId.toString(),
                      "parentOrderId":od.order.orderId.toString(),
                      "api_key":api,
                        "api_secret":secret,
                        "time":FieldValue.serverTimestamp(),
                        'closed':false,
                        "reduceOnly":od.order.isReduceOnly,
                        "userId":doc.data().uid.toString(),
                      },orderQty,doc.data().email);
                
                    }
                    // else if(error.toString().includes("ReduceOnly Order is rejected")){
                    //   od.order.isReduceOnly=false;
                    // }
                    else if(precision>0){
                      precision=precision-1;
                    }
                    if( !error.toString().includes("Quantity less than")){
                    binance.futuresOrder({
                      symbol:od.order.symbol,
                      side:od.order.orderSide,
                      type:od.order.orderType,
                      quantity:orderQty.toFixed(precision),
                      price:od.order.originalPrice,
                      stopPrice:od.order.stopPrice,
                      reduceOnly:od.order.isReduceOnly,
                      closePosition:od.order.isCloseAll,
                      
                            
                      
                    })
                        .then((data) => {
                          db.collection("childOrder").add({
                            "symbol":od.order.symbol,
                          "side":od.order.orderSide,
                          "type":od.order.orderType,
                          "quantity":orderQty.toFixed(precision), 
                          "price":od.order.originalPrice,
                          "stopPrice":od.order.stopPrice,
                          "orderId":data.orderId.toString(),
                          "parentOrderId":od.order.orderId.toString(),
                          "api_key":api,
                          "api_secret":secret,
                          "time":FieldValue.serverTimestamp(),
                          'closed':false,
                          "reduceOnly":od.order.isReduceOnly,
                          "userId":doc.data().uid.toString(),
                          }).catch((error)=>{
                            console.error("childOrder firebase saving order:"+error);
                          });
                          })
                          .catch((error) => {
                            if(error.toString().includes("ReduceOnly Order is rejected")){
                              reduceOnly(api,secret,od.order.symbol,od.order.orderType,od.order.orderSide,od.order.originalPrice,od.order.stopPrice,precision,orderQty.toFixed(precision));
                            }
                            console.log(orderQty.toFixed(precision));
                            console.log(precision);
                            console.error("allOrdersError2 saving order:"+error);
                            console.log("user  :"+doc.data().email);
                            
                          });
                        }
                    
                  });
          
            
          }
        }).catch((error) => {
        
          console.error("allOrdersError saving order:"+error);
          console.log("user  :"+doc.data().email);
          
         
        });
      }
      catch(err){
        console.log("error in place order :"+err);
      }
 
    });
  }
}
catch(err){
  console.log("error in place order :"+err);
}
}
async function reduceOnly(api,secret,symbol,orderType,orderSide,originalPrice,stopPrice,precision,orderQty){
  try{
    console.log("reduceonlyyyy");
  const client =Binance({
    apiKey:api,
    apiSecret:secret,
    // wsBase:process.env.ws_base
  });
  let availableQty=0;
  let existingQty=0;
  const position = await client.futuresPositionRisk({symbol:symbol}).catch((error)=>{
    console.log("error future risk:"+error);
   
  });

  for (var i=0;i<position.length;i++) {
    try {
      if(position[i].positionAmt!=0){
        availableQty=availableQty*1+position[i].positionAmt*1;
        console.log(symbol+" balance"+position[i].positionAmt);
      }
    } catch (err) {
      console.error(err);
    }
  }
  const openOrders = await client.futuresOpenOrders().catch((error)=>{
    console.log("error future risk:"+error);
    
  });
  console.log("open orders");
  for (const order of openOrders) {
    try {
     if(order.symbol==symbol){
      if(order.side==orderSide && order.type==orderType){
        existingQty=existingQty*1+order.origQty*1;
      }
      else if(order.side!=orderSide){
        availableQty=availableQty*1+order.origQty*1;
      }
      console.log(order.symbol);
      
      console.log(order.price);
      console.log(order.stopPrice);
      console.log(order.origQty);
      console.log(order.side);
      console.log(order.type);
      console.log(orderQty);
     }

      
    } catch (err) {
      console.error(err);
    }
  }
  console.log("reduce -only ----");
  console.log(availableQty);
      console.log(existingQty);
}
catch(err){
  console.log("error in reduce only :"+err);
}
}
function getMinimumNumber(precision) {
  let num = 0.0;
  let power = -precision;

  while(num === 0.0) {
    num = Math.pow(10, power);
    power++;
  }

  return num;
}
async function quantityLessThan(api,secret,order,precision,childOrder,orderQty,email){
  try{
    console.log("quantityLessThan");
    precision =precision*1+1;
    order.quantity=orderQty.toFixed(precision);
    console.log(orderQty.toFixed(precision));
    childOrder.quantity=orderQty.toFixed(precision);
    const binance =Binance({
      apiKey:api,
      apiSecret:secret
    });
    await binance.futuresOrder(order)
        .then((data) => {
          console.log("quantity error solved");
          console.log(email);
          childOrder.orderId=data.orderId.toString();
          db.collection("childOrder").add(childOrder).catch((error)=>{
            console.error("childOrder firebase saving order:"+error);
          });
         
          })
          .catch((error) => {
            if( error.toString().includes("Quantity less than")){
              console.log(orderQty.toFixed(precision));
              console.log(precision);
              console.error("quantityLessThan error:"+error);
              console.error(email);
              quantityLessThan(api,secret,order,precision,childOrder,orderQty,email);
        
            }
            else  if( error.toString().includes("Precision is over the maximum defined for this asset")){
              console.log(orderQty.toFixed(precision));
              console.log(precision);
              console.error("quantityLessThan error:"+error);
              console.error(email);
            
              orderQty= getMinimumNumber(precision-1);
              precision=precision-2;
              quantityLessThan(api,secret,order,precision,childOrder,orderQty,email);
        
            }
            else  if( error.toString().includes("ReduceOnly Order is rejected")){
              console.log(orderQty.toFixed(precision));
              console.log(precision);
              console.error("quantityLessThan error:"+error);
              console.error(email);
            
              reduceOnly(api,secret,order.symbol,order.type,order.side,order.price,order.stopPrice,precision,orderQty.toFixed(precision));
        
            }

           

  
          });
        }
        catch(err){
          console.log("error in quantity only :"+err);
        }
 

} 

async function followPlaceOrder(od,traderBalance,trader,userId){
  console.log("trader balance :"+traderBalance);
  
  console.log("trader :"+trader);
  try{
  let allocation =od.order.originalQuantity/traderBalance;
 
  const doc = await admin.firestore().collection("users").doc(userId).get();
 
    const api = doc.data().api_key;
    const secret = doc.data().api_secret;
    try{
    const binance =Binance({
      apiKey:api,
      apiSecret:secret
    });
    let array1 = [];
    let orderQty=od.order.originalQuantity;
    
    // await binance.futuresLeverage({
    //   symbol: od.order.symbol,
    //   leverage: doc.data().leverage,
    // }).then((data)=>{
  
    // }).catch((error) => {
      
    //   console.error("allOrdersError saving order:"+error);
     
     
    // });
    binance.futuresAccountBalance().then(async (balance)=>{
  
 
   for(var i=0;i<balance.length;i++){
    var element=balance[i];
    array1.push(element);
    if(element.asset=="USDT"){
    
      orderQty=allocation*element.balance*doc.data().allocation/100;
      console.log(element.asset);
      console.log(traderBalance);
      console.log(allocation);
      console.log(element.balance);
      console.log(doc.data().allocation);
      console.log(doc.data().email);
      console.log(orderQty);
      console.log("finish");
      break;
    }
   }

  let precision=8;
  let pricePrecision=8;
  precision=od.order.originalQuantity.countDecimals();
// await binance.exchangeInfo({
//   symbol:od.order.symbol.split("_")[0]
//  }).then((data)=>{
//   db.collection("exchangeInfo").doc(od.order.symbol).set(data);
  

 
//  }).catch((error) => {
//      console.log(od.order.symbol);
//   console.error("exchangeInfoError saving order:"+error);
  
 
// });
   if(precision<0){
precision=0;
   }
    let array2 = [];
    console.log("precise value");
    console.log(precision);
  console.log(orderQty.toFixed(precision));


    if(od.order.stopPrice==0 && od.order.orderType!="MARKET"){
    
     console.log("not market");
     
    binance.futuresOrder({
      symbol:od.order.symbol,
      side:od.order.orderSide,
      type:od.order.orderType,
      quantity:orderQty.toFixed(precision),        
      price:od.order.originalPrice,   
      recvWindow:50000,
      reduceOnly:od.order.isReduceOnly,
            
      
    })
        .then((data) => {
         
          db.collection("childOrder").add({
            "symbol":od.order.symbol,
          "side":od.order.orderSide,
          "type":od.order.orderType,
          "quantity":orderQty.toFixed(precision), 
          "price":od.order.originalPrice,
          "orderId":data.orderId.toString(),
          "parentOrderId":od.order.orderId.toString(),
          "api_key":api,
          "api_secret":secret,
          "time":FieldValue.serverTimestamp(),
          'closed':false,
          "reduceOnly":od.order.isReduceOnly,
          "userId":doc.data().uid.toString(),
          
          }).catch((error)=>{
            console.error("childOrder firebase saving order:"+error);
          });
          })
          .catch((error) => {
            console.log("first order error:"+error);
            if( error.toString().includes("Quantity less than")){
              quantityLessThan(api,secret,{
                symbol:od.order.symbol,
                side:od.order.orderSide,
                type:od.order.orderType,
                quantity:orderQty.toFixed(precision),        
                price:od.order.originalPrice,   
                recvWindow:50000,
                reduceOnly:od.order.isReduceOnly,
                      
                
              },precision,{
                "symbol":od.order.symbol,
              "side":od.order.orderSide,
              "type":od.order.orderType,
              "quantity":orderQty.toFixed(precision), 
              "orderId":od.order.orderId.toString(),
              "parentOrderId":od.order.orderId.toString(),
              "api_key":api,
                "api_secret":secret,
                "time":FieldValue.serverTimestamp(),
                'closed':false,
                "reduceOnly":od.order.isReduceOnly,
                "userId":userId,
              },orderQty,doc.data().email);
        
            }
            else if(precision>0){
              precision=precision-1;
            }
            if( !error.toString().includes("Quantity less than")){
            binance.futuresOrder({
              symbol:od.order.symbol,
              side:od.order.orderSide,
              type:od.order.orderType,
              quantity:orderQty.toFixed(precision),        
              price:od.order.originalPrice,   
              recvWindow:50000,
              reduceOnly:od.order.isReduceOnly,
                    
              
            })
                .then((data) => {
                  db.collection("childOrder").add({
                    "symbol":od.order.symbol,
                  "side":od.order.orderSide,
                  "type":od.order.orderType,
                  "quantity":orderQty.toFixed(precision-1), 
                  "price":od.order.originalPrice,
                  "orderId":data.orderId.toString(),
                  "parentOrderId":od.order.orderId.toString(),
                  "api_key":api,
                  "api_secret":secret,
                  "time":FieldValue.serverTimestamp(),
                  'closed':false,
                  "reduceOnly":od.order.isReduceOnly,
                  "userId":doc.data().uid.toString(),
                  
                  }).catch((error)=>{
                    console.error("childOrder firebase saving order:"+error);
                  });
                  })
                  .catch((error) => {
                    console.log(orderQty.toFixed(precision));
                    console.log(precision);
                    console.error("allOrdersError2 saving order:"+error);
                   
                  });
                }
           
           
          });
    
        }
        else if(od.order.orderType=="MARKET"){
         
          console.log("market");
         
        binance.futuresOrder({
          symbol:od.order.symbol,
          side:od.order.orderSide,
          type:od.order.orderType,
          quantity:orderQty.toFixed(precision),        
          recvWindow:50000,
          reduceOnly:od.order.isReduceOnly,
                
          
        })
            .then((data) => {
              db.collection("childOrder").add({
                "symbol":od.order.symbol,
              "side":od.order.orderSide,
              "type":od.order.orderType,
              "quantity":orderQty.toFixed(precision), 
              "orderId":data.orderId.toString(),
              "parentOrderId":od.order.orderId.toString(),
              "api_key":api,
                "api_secret":secret,
                "time":FieldValue.serverTimestamp(),
                'closed':false,
                "reduceOnly":od.order.isReduceOnly,
                "userId":doc.data().uid.toString(),
              }).catch((error)=>{
                console.error("childOrder firebase saving order:"+error);
              });
              })
              .catch((error) => {
                console.log("first order error:"+error);
                if( error.toString().includes("Quantity less than")){
                  quantityLessThan(api,secret,{
                    symbol:od.order.symbol,
                    side:od.order.orderSide,
                    type:od.order.orderType,
                    quantity:orderQty.toFixed(precision),        
                    recvWindow:50000,
                    reduceOnly:od.order.isReduceOnly,
                          
                    
                  },precision,{
                    "symbol":od.order.symbol,
                  "side":od.order.orderSide,
                  "type":od.order.orderType,
                  "quantity":orderQty.toFixed(precision), 
                  "orderId":od.order.orderId.toString(),
                  "parentOrderId":od.order.orderId.toString(),
                  "api_key":api,
                    "api_secret":secret,
                    "time":FieldValue.serverTimestamp(),
                    'closed':false,
                    "reduceOnly":od.order.isReduceOnly,
                    "userId":userId,
                  },orderQty,doc.data().email);
            
                }
                else if(precision>0){
                  precision=precision-1;
                }
                if( !error.toString().includes("Quantity less than")){
                binance.futuresOrder({
                  symbol:od.order.symbol,
                  side:od.order.orderSide,
                  type:od.order.orderType,
                  quantity:orderQty.toFixed(precision),        
                  recvWindow:50000,
                  reduceOnly:od.order.isReduceOnly,
                        
                  
                })
                    .then((data) => {
                      db.collection("childOrder").add({
                        "symbol":od.order.symbol,
                      "side":od.order.orderSide,
                      "type":od.order.orderType,
                      "quantity":orderQty.toFixed(precision), 
                      "orderId":data.orderId.toString(),
                      "parentOrderId":od.order.orderId.toString(),
                      "api_key":api,
                        "api_secret":secret,
                        "time":FieldValue.serverTimestamp(),
                        'closed':false,
                        "reduceOnly":od.order.isReduceOnly,
                        "userId":doc.data().uid.toString(),
                      }).catch((error)=>{
                        console.error("childOrder firebase saving order:"+error);
                      });
                      })
                      .catch((error) => {
                        console.log(orderQty.toFixed(precision));
                        console.log(precision);
                        console.error("allOrdersError2 saving order:"+error);
                      
              
                      });
                    }
              
      
              });
            }
            else if(od.order.stopPrice!=0 && od.order.orderType=="STOP_MARKET"){
            
            console.log("hereeeeee stop market order");
            console.log("reduceOnly:"+od.order.isReduceOnly);
              binance.futuresOrder({
                symbol:od.order.symbol,
                side:od.order.orderSide,
                type:od.order.orderType,
                quantity:orderQty.toFixed(precision),
                stopPrice:od.order.stopPrice,   
                reduceOnly:od.order.isReduceOnly,
                workingType:od.order.stopPriceWorkingType,
                recvWindow:50000,
                
              }).then((data) => {
                console.log("stop market success");
                    db.collection("childOrder").add({
                      "symbol":od.order.symbol,
                    "side":od.order.orderSide,
                    "type":od.order.orderType,
                    "quantity":orderQty.toFixed(precision), 
                    "orderId":data.orderId.toString(),
                    "parentOrderId":od.order.orderId.toString(),
                    "api_key":api,
                      "api_secret":secret,
                      "time":FieldValue.serverTimestamp(),
                      'closed':false,
                      "reduceOnly":od.order.isReduceOnly,
                      "userId":doc.data().uid.toString(),
                    }).catch((error)=>{
                      console.error("childOrder firebase saving order:"+error);
                    });
                    })
                    .catch((error) => {
                      console.log("first order error:"+error);
                      if( error.toString().includes("Quantity less than")){
                        quantityLessThan(api,secret,{
                          symbol:od.order.symbol,
                          side:od.order.orderSide,
                          type:od.order.orderType,
                          quantity:orderQty.toFixed(precision),
                          stopPrice:od.order.stopPrice,   
                          reduceOnly:od.order.isReduceOnly,
                          workingType:od.order.stopPriceWorkingType,
                          recvWindow:50000,
                          
                        },precision,{
                          "symbol":od.order.symbol,
                        "side":od.order.orderSide,
                        "type":od.order.orderType,
                        "quantity":orderQty.toFixed(precision), 
                        "orderId":od.order.orderId.toString(),
                        "parentOrderId":od.order.orderId.toString(),
                        "api_key":api,
                          "api_secret":secret,
                          "time":FieldValue.serverTimestamp(),
                          'closed':false,
                          "reduceOnly":od.order.isReduceOnly,
                          "userId":userId,
                        },orderQty,doc.data().email);
                  
                      }
                      else  if(precision>0){
                        precision=precision-1;
                      }
                      if( !error.toString().includes("Quantity less than")){
                      binance.futuresOrder({
                        symbol:od.order.symbol,
                        side:od.order.orderSide,
                        type:od.order.orderType,
                        quantity:orderQty.toFixed(precision),
                        stopPrice:od.order.stopPrice,   
                        reduceOnly:od.order.isReduceOnly,
                        workingType:od.order.stopPriceWorkingType,
                        recvWindow:50000,
                        
                      }).then((data) => {
                        console.log("stop market again success");
                            db.collection("childOrder").add({
                              "symbol":od.order.symbol,
                            "side":od.order.orderSide,
                            "type":od.order.orderType,
                            "quantity":orderQty.toFixed(precision), 
                            "orderId":data.orderId.toString(),
                            "parentOrderId":od.order.orderId.toString(),
                            "api_key":api,
                              "api_secret":secret,
                              "time":FieldValue.serverTimestamp(),
                              'closed':false,
                              "reduceOnly":od.order.isReduceOnly,
                              "userId":doc.data().uid.toString(),
                            }).catch((error)=>{
                              console.error("childOrder firebase saving order:"+error);
                            });
                            })
                            .catch((error) => {
                              console.log(orderQty.toFixed(precision));
                              console.log(precision);
                              console.error("allOrdersError2 saving order:"+error);
                            
                            });
                          }
                    
                    });
           
          
            
                }
        else{
        
          binance.futuresOrder({
            symbol:od.order.symbol,
            side:od.order.orderSide,
            type:od.order.orderType,
            quantity:orderQty.toFixed(precision),
            price:od.order.originalPrice,
            stopPrice:od.order.stopPrice,
            reduceOnly:od.order.isReduceOnly,
                  
            
          })
              .then((data) => {
                db.collection("childOrder").add({
                  "symbol":od.order.symbol,
                "side":od.order.orderSide,
                "type":od.order.orderType,
                "quantity":orderQty.toFixed(precision), 
                "price":od.order.originalPrice,
                "stopPrice":od.order.stopPrice,
                "orderId":data.orderId.toString(),
                "parentOrderId":od.order.orderId.toString(),
                "api_key":api,
                "api_secret":secret,
                "time":FieldValue.serverTimestamp(),
                'closed':false,
                "reduceOnly":od.order.isReduceOnly,
                "userId":doc.data().uid.toString(),
                }).catch((error)=>{
                  console.error("childOrder firebase saving order:"+error);
                });
                })
                .catch((error) => {
                  console.log("first order error:"+error);
                  if( error.toString().includes("Quantity less than")){
                    quantityLessThan(api,secret,{
                      symbol:od.order.symbol,
                      side:od.order.orderSide,
                      type:od.order.orderType,
                      quantity:orderQty.toFixed(precision),
                      price:od.order.originalPrice,
                      stopPrice:od.order.stopPrice,
                      reduceOnly:od.order.isReduceOnly,
                            
                      
                    },precision,{
                      "symbol":od.order.symbol,
                    "side":od.order.orderSide,
                    "type":od.order.orderType,
                    "quantity":orderQty.toFixed(precision), 
                    "orderId":od.order.orderId.toString(),
                    "parentOrderId":od.order.orderId.toString(),
                    "api_key":api,
                      "api_secret":secret,
                      "time":FieldValue.serverTimestamp(),
                      'closed':false,
                      "reduceOnly":od.order.isReduceOnly,
                      "userId":doc.data().uid.toString(),
                    },orderQty,doc.data().email);
              
                  }
                  else if(precision>0){
                    precision=precision-1;
                  }
                  if( !error.toString().includes("Quantity less than")){
                  binance.futuresOrder({
                    symbol:od.order.symbol,
                    side:od.order.orderSide,
                    type:od.order.orderType,
                    quantity:orderQty.toFixed(precision),
                    price:od.order.originalPrice,
                    stopPrice:od.order.stopPrice,
                    reduceOnly:od.order.isReduceOnly,
                    
                          
                    
                  })
                      .then((data) => {
                        db.collection("childOrder").add({
                          "symbol":od.order.symbol,
                        "side":od.order.orderSide,
                        "type":od.order.orderType,
                        "quantity":orderQty.toFixed(precision), 
                        "price":od.order.originalPrice,
                        "stopPrice":od.order.stopPrice,
                        "orderId":data.orderId.toString(),
                        "parentOrderId":od.order.orderId.toString(),
                        "api_key":api,
                        "api_secret":secret,
                        "time":FieldValue.serverTimestamp(),
                        'closed':false,
                        "reduceOnly":od.order.isReduceOnly,
                        "userId":doc.data().uid.toString(),
                        }).catch((error)=>{
                          console.error("childOrder firebase saving order:"+error);
                        });
                        })
                        .catch((error) => {
                          console.log(orderQty.toFixed(precision));
                          console.log(precision);
                          console.error("allOrdersError2 saving order:"+error);
                          
                        });
                      }
                  
                });
        
          
        }
      }).catch((error) => {
      
        console.error("allOrdersError saving order:"+error);
        
       
      });
    }
    catch(err){
      console.log("error in place order :"+err);
    }

 
  
}
catch(err){
  console.log("error in place order :"+err);
}
}
async function closeAllPositions(trader) {
  const users = await admin.firestore().collection("users").where("follows", "array-contains", trader).get();
  if (users.docs.length>0) {
    users.docs.forEach(async (doc) =>{
      try{
      const api = doc.data().api_key;
      const secret = doc.data().api_secret;
      const client =Binance({
        apiKey:api,
        apiSecret:secret,
        // wsBase:process.env.ws_base
      });
 let cnt =false;
 
  // const futures = positions.filter(pos => parseFloat(pos[0].positionAmt) !== 0);
  const position = await client.futuresPositionRisk().catch((error)=>{
    console.log("error future risk:"+error);
    cnt=true;
  });
  
    for (var i=0;i<position.length;i++) {
      try {
        
       
        const symbol = position[i].symbol;
      if(!cnt){
        
      
      
      if(position[i].positionAmt==0){
        console.log(symbol+" 0 balance");
      }
     else if (position[i].positionAmt > 0) {
        
        await client.futuresOrder({
          symbol:symbol,
          side:"SELL",
          type:"MARKET",
          quantity:Math.abs(parseFloat(position[i].positionAmt)),  
          recvWindow:50000,   
          reduceOnly:true,
          
        })
            .then((data) => {
             console.log("close succes");
              })
              .catch((error) => {
                
                console.error("close orderError saving order:"+error);         
              
              });
       
      } else {
        await client.futuresOrder({
          symbol:symbol,
          side:"BUY",
          type:"MARKET",
          quantity:Math.abs(parseFloat(position[i].positionAmt)),  
          recvWindow:50000,   
          reduceOnly:true,
          
        })
            .then((data) => {
             console.log("close succes");
              })
              .catch((error) => {
                
                console.error("close orderError saving order:"+error);         
              
              });
      }
    }
   
      console.log(`Closed position for ${symbol}`);
    } catch (err) {
      console.error(err);
    }
  }
  const openOrders = await client.futuresOpenOrders().catch((error)=>{
    console.log("error future risk:"+error);
    
  });
 console.log(openOrders.length);
  for (const order of openOrders) {
    try {
      await client.futuresCancelOrder({
        symbol: order.symbol,
        orderId: order.orderId
      }).catch((error)=>{
        console.log("error future risk:"+error);
        
      });

      console.log(`Canceled order for ${order.symbol}`);
    } catch (err) {
      console.error(err);
    }
  }
} catch (err) {
  console.error(err);
}
});
  }
}
async function closeSymbolPosition(trader,orderSymbol,parentOrderId) {
  console.log("closeSymbolPositionnnnnnnnnnnn");
  console.log(orderSymbol);
  const settings = await admin.firestore().collection("settings").doc("settings").get();
  const copy =settings.data().copy;
  const copyUsers =settings.data().copyUsers;
  const query = copy
  ? admin.firestore().collection("users").where("email", "in", copyUsers)
  : admin.firestore().collection("users").where("follows", "array-contains", trader);
  const users = await query.get();
  // const users = await admin.firestore().collection("users").where("follows", "array-contains", trader).get();
  if (users.docs.length>0) {
    users.docs.forEach(async (doc) =>{
      try{
      const api = doc.data().api_key;
      const secret = doc.data().api_secret;
      const client =Binance({
        apiKey:api,
        apiSecret:secret,
        // wsBase:process.env.ws_base
      });
      let cnt =false;
      const position = await client.futuresPositionRisk().catch((error)=>{
        console.log("error future risk:"+error);
        console.log("user is:"+doc.data().email);
        cnt=true;
      });
      
        for (var i=0;i<position.length;i++) {
          try {
            
           
            const symbol = position[i].symbol;
      if(symbol==orderSymbol){
     
      if(!cnt){
        
      
      
      if(position[i].positionAmt==0){
        console.log(symbol+" 0 balance");
      }
     else if (position[i].positionAmt > 0) {
        
        await client.futuresOrder({
          symbol:symbol,
          side:"SELL",
          type:"MARKET",
          quantity:Math.abs(parseFloat(position[i].positionAmt)),  
          recvWindow:50000,   
          reduceOnly:true,
          
        })
            .then((data) => {
              db.collection("childOrder").add({
                "symbol":symbol,
              "side":"SELL",
              "type":"MARKET",
              "quantity":Math.abs(parseFloat(position[i].positionAmt)), 
              "price":0,
              "orderId":data.orderId.toString(),
              "parentOrderId":parentOrderId.toString(),
              "api_key":api,
              "api_secret":secret,
              "time":FieldValue.serverTimestamp(),
              'closed':true,
              "reduceOnly":true,
              "userId":doc.data().uid.toString(),
              
              }).catch((error)=>{
                console.error("childOrder firebase saving order:"+error);
              });
             console.log("close succes");
              })
              .catch((error) => {
                
                console.error("close orderError saving order:"+error);         
              
              });
       
      } else {
        await client.futuresOrder({
          symbol:symbol,
          side:"BUY",
          type:"MARKET",
          quantity:Math.abs(parseFloat(position[i].positionAmt)),  
          recvWindow:50000,   
          reduceOnly:true,
          
        })
            .then((data) => {
              db.collection("childOrder").add({
                "symbol":symbol,
              "side":"BUY",
              "type":"MARKET",
              "quantity":Math.abs(parseFloat(position[i].positionAmt)), 
              "price":0,
              "orderId":data.orderId.toString(),
              "parentOrderId":parentOrderId.toString(),
              "api_key":api,
              "api_secret":secret,
              "time":FieldValue.serverTimestamp(),
              'closed':true,
              "reduceOnly":true,
              "userId":doc.data().uid.toString(),
              
              }).catch((error)=>{
                console.error("childOrder firebase saving order:"+error);
              });
             console.log("close succes");
              })
              .catch((error) => {
                
                console.error("close orderError saving order:"+error);         
              
              });
      }
    }
    }
   
      console.log(`Closed position for ${symbol}`);
    } catch (err) {
      console.error(err);
      console.log("user is:"+doc.data().email);
    }
  }
  const openOrders = await client.futuresOpenOrders().catch((error)=>{
    console.log("error future risk:"+error);
    
  });
 console.log(openOrders.length);
  for (const order of openOrders) {
    try {
      if(order.symbol==orderSymbol){
      await client.futuresCancelOrder({
        symbol: order.symbol,
        orderId: order.orderId
      }).catch((error)=>{
        console.log("error future risk:"+error);
        
      });

      console.log(`Canceled order for ${order.symbol}`);
    }
    } catch (err) {
      console.error(err);
    }
  }
} catch (err) {
  console.error(err);
  console.log("user is:"+doc.data().email);
}
});
  }
}
async function followTrader(traderId,traderApi,traderSecret,userId) {
    try{
    let traderBalance =0; 
   
    const trader =Binance({
      apiKey:traderApi,
      apiSecret:traderSecret,
      // wsBase:process.env.ws_base
    });
    const doc = await admin.firestore().collection("users").doc(userId).get();
    
  
        const api = doc.data().api_key;
        const secret = doc.data().api_secret;
        
        let ratio =1;
        const client =Binance({
          apiKey:api,
          apiSecret:secret,
          // wsBase:process.env.ws_base
        });
  
    const positions = await trader.futuresAccountBalance().catch((error)=>{
      console.log("error future risk:"+error);
      
    });
   
    const  balance=await  client.futuresAccountBalance().catch((error)=>{
      console.log("error future risk:"+error);
      
    });
    for (const future of positions) {
      try {
        
        if(future.asset=="USDT"){
        traderBalance=future.balance;
        
   
    for(var i=0;i<balance.length;i++){
     var element=balance[i];
    
     if(element.asset=="USDT"){
     
      ratio=element.balance*doc.data().allocation/(100*traderBalance);
       console.log("ratio is :"+ratio);
       console.log("element.balance is :"+element.balance);
       console.log("doc.data().allocation is :"+doc.data().allocation);
       console.log("traderBalance is :"+traderBalance);
       break;
     }
    }
    }
  }
    catch(err){
      console.log(err);
    }
  
  }
  let cnt =false;
  const position = await trader.futuresPositionRisk().catch((error)=>{
    console.log("error future risk:"+error);
    cnt=true;
  });
  
    for (var i=0;i<position.length;i++) {
      try {
        
       
        const symbol = position[i].symbol;
     
        if(!cnt){
          
        
          precision=Math.abs(parseFloat(position[i].positionAmt)).countDecimals();
          if(precision<0){
            precision=0;
                 }
        if(position[i].positionAmt==0){
          // console.log(symbol+" 0 balance");
        }
       else if (position[i].positionAmt > 0) {
    
          
        console.log(`Closed position for ${symbol}`);
          
          await client.futuresOrder({
            symbol:symbol,
            side:"BUY",
            type:"MARKET",
            quantity:Math.abs(parseFloat(position[i].positionAmt*ratio)).toFixed(precision),  
            recvWindow:50000,   
           
            
          })
              .then((data) => {
               console.log("close succes");
                })
                .catch((error) => {
                  
                  console.error("close orderError saving order:"+error);         
                
                });
         
        } else {
          await client.futuresOrder({
            symbol:symbol,
            side:"SELL",
            type:"MARKET",
            quantity:Math.abs(parseFloat(position[i].positionAmt*ratio)).toFixed(precision),  
            recvWindow:50000,   
         
            
          })
              .then((data) => {
               console.log("close succes");
                })
                .catch((error) => {
                  
                  console.error("close orderError saving order:"+error);         
                
                });
        }
      }
      
     
        
      } catch (err) {
        console.error(err);
      }
    }
    const openOrders = await trader.futuresOpenOrders().catch((error)=>{
      console.log("error future risk:"+error);
      
    });
  
    for (const order of openOrders) {
      try {
      
        const ordrs = await admin.firestore().collection("orders").where("order.clientOrderId","==",order.clientOrderId.toString()).get(); 
          console.log("orderid is:"+order.orderId.toString());
          console.log("orderid is:"+order.clientOrderId.toString());
          console.log("userId is:"+userId);
          console.log("ordrs is:"+ordrs.docs.length);
          ordrs.docs.forEach(async (ordr) =>{
       await followPlaceOrder(ordr.data(),traderBalance,traderId,userId);
          });
        
  
     
     
      } catch (err) {
        console.error(err);
      }
    }
  } catch (err) {
    console.error(err);
  }
  
  }
  
  async function closeAllUser(userId) {
    try{
    const doc = await admin.firestore().collection("users").doc(userId).get();
    if (doc.exists) {
      
        const api = doc.data().api_key;
        const secret = doc.data().api_secret;
        const client =Binance({
          apiKey:api,
          apiSecret:secret,
          // wsBase:process.env.ws_base
        });
    const positions = await client.futuresAccountBalance().catch((error)=>{
      console.log("error future risk:"+error);
      
    });
   
    // const futures = positions.filter(pos => parseFloat(pos[0].positionAmt) !== 0);
  let cnt =false;
    const position = await client.futuresPositionRisk().catch((error)=>{
      console.log("error future risk:"+error);
      cnt=true;
    });
    
      for (var i=0;i<position.length;i++) {
        try {
          
         
          const symbol = position[i].symbol;
        
        if(!cnt){
          
        
        
        if(position[i].positionAmt==0){
          console.log(symbol+" 0 balance");
        }
       else if (position[i].positionAmt > 0) {
          
          await client.futuresOrder({
            symbol:symbol,
            side:"SELL",
            type:"MARKET",
            quantity:Math.abs(parseFloat(position[i].positionAmt)),  
            recvWindow:50000,   
            reduceOnly:true,
            
          })
              .then((data) => {
               console.log("close succes");
                })
                .catch((error) => {
                  
                  console.error("close orderError saving order:"+error);         
                
                });
         
        } else {
          await client.futuresOrder({
            symbol:symbol,
            side:"BUY",
            type:"MARKET",
            quantity:Math.abs(parseFloat(position[i].positionAmt)),  
            recvWindow:50000,   
            reduceOnly:true,
            
          })
              .then((data) => {
               console.log("close succes");
                })
                .catch((error) => {
                  
                  console.error("close orderError saving order:"+error);         
                
                });
        }
      }
     
        console.log(`Closed position for ${symbol}`);
      } catch (err) {
        console.error(err);
      }
    }
    const openOrders = await client.futuresOpenOrders().catch((error)=>{
      console.log("error future risk:"+error);
      
    });
   console.log(openOrders.length);
    for (const order of openOrders) {
      try {
        await client.futuresCancelOrder({
          symbol: order.symbol,
          orderId: order.orderId
        }).catch((error)=>{
          console.log("error future risk:"+error);
          
        });
  
        console.log(`Canceled order for ${order.symbol}`);
      } catch (err) {
        console.error(err);
      }
    }
  
    }
  } catch (err) {
    console.error(err);
  }
  }
  async function openOrdersAndPositions(api,secret) {
    try{
   
    if (api!=""&&secret!="") {
      
        console.log("api is"+api);
        console.log("secret is"+secret);
        const client =Binance({
          apiKey:api,
          apiSecret:secret,
          // wsBase:process.env.ws_base
        });
    const positions = await client.futuresAccountBalance().catch((error)=>{
      console.log("error future risk:"+error);
      
    });
   let data={"positions":[],"openOrders":[]};
   let positionList=[];
   
    // const futures = positions.filter(pos => parseFloat(pos[0].positionAmt) !== 0);
  let cnt =false;
    const position = await client.futuresPositionRisk().catch((error)=>{
      console.log("error future risk:"+error);
      cnt=true;
    });
    
      for (var i=0;i<position.length;i++) {
        try {
          
         
          
        
        
        if(position[i].positionAmt!=0){
       positionList.push(position[i]);
        }
      
     
        
      } catch (err) {
        console.error(err);
      }
    }
    data.positions=positionList;
    const openOrders = await client.futuresOpenOrders().catch((error)=>{
      console.log("error future risk:"+error);
      
    });
   console.log(openOrders.length);
    data.openOrders =openOrders;
    return data;
  
    }
  } catch (err) {
    return "error";
    console.error(err);
  }
  }
  async function test(){
    const api = "w67031gAf3dPTuUomF2gzT2LsJA9yaC4hyz6usNouhDCRX3lQDGU8AE6xxHot6yG";
    const secret = "0TXZ2jujlBFTx2cVOD96MfV9JNFunP6CVNoKcjZM9o9aDDatDZpoUJpfDjJHRJTh";
    
  
  
  }
  let wsKeys={"test":"test"};
  async function binance(){
    try{
      console.log("length is"+clientList.length);
      for(const client1 in clientList){
        try{
          console.log(client1.toString());
        // client1.closeAll();
       
        
      }catch(err){
        console.log("inner error"+JSON.stringify(err, null, 2));
        console.log("inner error"+err);
      }
        
      }
     
    }catch(err){
      console.log(err);
    }
    clientList = [];
    const users = await admin.firestore().collection("traders").get();
    if (users.docs.length>0) {
      users.docs.forEach(async (doc) =>{
        const KE = doc.data().api_key;
        const SE = doc.data().api_secret;
        const trader=doc.data().uid;
        const minimumBalance=doc.data().minimumBalance;
        console.log("listening to "+trader);
    const wsClient =  new WebsocketClient(
        {
          api_key: KE,
          api_secret: SE,
          beautify: true,
          // Disable ping/pong ws heartbeat mechanism (not recommended)
          disableHeartbeat: true,
        },
    );
    
    // if(wsKeys[KE]!=undefined&&wsKeys[KE]!=null){
    //   console.log("hereeeeeeeeeeeee");
    //   console.log(wsKeys);
    // console.log(wsKeys[KE]);
    // console.log(KE);
    // wsClient.close({wsKey:wsKeys[KE]});
    // }
    
  
    
  
   
    wsClient.on("open", (data) => {
      wsKeys[KE]=data.wsKey;
      console.log("connection opened op", data.wsKey, data.ws.target.url);
      console.log(data);
    });
  
    wsClient.on("close", (data) => {
      console.log("connection close op");
    });
    wsClient.on("formattedMessage", async (data) => {
     
    
      try{
       if(data.eventType=="ORDER_TRADE_UPDATE" && data.order.executionType=="NEW" && data.order.orderType =="MARKET" && data.order.isReduceOnly==true){
          console.log("closeddddddddddddddddddddd");
          const orderQty=data.order.originalQuantity;
          const client =Binance({
            apiKey:KE,
            apiSecret:SE,
            // wsBase:process.env.ws_base
          });
      
      let cnt =true;
      const position = await client.futuresPositionRisk().catch((error)=>{
        console.log("error future risk:"+error);
        cnt=true;
      });
      
        for (var i=0;i<position.length;i++) {
        
            
           
            
        try {
         
          const symbol = position[i].symbol;
         
          if(symbol==data.order.symbol){
         
         
          if(position[i].positionAmt==0){
            cnt =false;
            closeSymbolPosition(trader,data.order.symbol,data.order.orderId.toString());
            data.order.orderId=data.order.orderId.toString();
            db.collection("closedOrders").add(data).catch((error)=>{
              console.error("closedOrders firebase saving order:"+error);
            });
          }
          else{
            console.log("elseeeeeee");
            console.log(position[i].positionAmt);
            console.log(orderQty);
          }
        }
        }
        catch(err){
          console.log("error future risk:"+err);
        }
      }
      if(cnt){
      console.log("formattedMessage order: ", JSON.stringify(data, null, 2));
      data.order.orderId=data.order.orderId.toString();
      db.collection("orders").add(data).catch((error)=>{
        console.error("Order firebase saving order:"+error);
      });
     
      let array1 = [];
     
     
  
      for(var i=0;i<position.length;i++){
        var element =position[i];
        if(data.order.symbol.lastIndexOf(element.asset)>1 &&element.balance!=0){
          console.log("yayyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy");
          console.log(element);
          
          placeOrder(data,element.balance,trader);
          break;
        }
      }
     
      }
   
   
     
      
       
         
        } 
       else if(data.eventType=="ORDER_TRADE_UPDATE" && data.order.executionType=="NEW"){
          console.log("formattedMessage order: ", JSON.stringify(data, null, 2));
          data.order.orderId=data.order.orderId.toString();
          db.collection("orders").add(data).catch((error)=>{
            console.error("Order firebase saving order:"+error);
          });
          const binance =Binance({
            apiKey:KE,
            apiSecret:SE
          });
          let array1 = [];
          binance.futuresAccountBalance().then((balance)=>{
         
        //  balance.forEach(element => {
          for(var i=0;i<balance.length;i++){
            var element =balance[i];
            if(data.order.symbol.lastIndexOf(element.asset)>1 &&element.balance!=0){
              console.log("yayyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy");
              console.log(element);
              
              placeOrder(data,element.balance,trader);
              break;
            }
          }
         
        //  });
       
       
          }).catch((error) => {
        
            console.error("balance error:"+error);
           
           
          });
          
        }
        else if(data.eventType=="ORDER_TRADE_UPDATE" && data.order.executionType=="CANCELED"){
          console.log("cancelleddddddddddddddddddddd");
          console.log("formattedMessage cancelled order: ", JSON.stringify(data, null, 2));
          data.order.orderId=data.order.orderId.toString();
          db.collection("cancelled").add(data).catch((error)=>{
            console.error("cancelled firebase saving order:"+error);
          });
          cancelOrder(data.order.orderId);
        }
   
        else{
          
          // console.log("formattedMessage closed order: ", JSON.stringify(data, null, 2));
          db.collection("formattedMessagea").add(data);
        }
       
    
        }
        catch(exc){
          console.log(JSON.stringify(data, null, 2));
       
        }
          
      
    });
  
    // read response to command sent via WS stream (e.g LIST_SUBSCRIPTIONS)
    wsClient.on("reply", (data) => {
      
      console.log("log reply: ", data);
    });
  
    // receive notification when a ws connection is reconnecting automatically
    wsClient.on("reconnecting", (data) => {
    
      console.log("ws automatically reconnecting.... "+data);
    });
  
    wsClient.on("reconnected", (data) => {
      db.collection("reconnected").add({"data":JSON.stringify(data, null, 2),
      "time":FieldValue.serverTimestamp(),})
      .then((docRef) => {
              console.log("allOrders reconnected with ID: "+docRef.id);
            })
            .catch((error) => {
              console.error("allOrdersreconnected saving order: "+error);
            });
    
      console.log("ws has reconnected "+data);
    });
  
    // Recommended: receive error events (e.g. first reconnection failed)
    wsClient.on("error", (data) => {
      console.log(data);
      
      console.log("ws saw error "+data);
    });
   
    // wsClient.subscribeSpotUserDataStream();
    wsClient.subscribeUsdFuturesUserDataStream();
    
   
  
   clientList.push(wsClient); 
      
     
    
  });
    }
  }
  async function userPnl(key,secret,fromYear,fromMonth,fromDay,toYear,toMonth,toDay) {
    try {
      const client = Binance({
        apiKey: key,
        apiSecret: secret
      });
      
      let startDate = new Date(fromYear, fromMonth-1, fromDay);
      let endDate = new Date(toYear, toMonth-1 , toDay*1+1, 0, 0, -1);
  
      let startOfMonth = startDate;
      let endOfMonth = new Date(fromYear, fromMonth-1 , fromDay*1+7, 0, 0, -1);
     
      let fullTrades=[];
      let fullOrders=[];
      let fullTransactions=[];
      let pnl = 0;
   while(startOfMonth<endDate){   
  
    
    
    const now = new Date();
    if(startOfMonth>now){
     console.log("break");
      break;
    }
    if(endOfMonth>now){
     
      endOfMonth=now;
    
    }
      const transactions =await client.futuresIncome ({ startTime: startOfMonth.getTime(), endTime: endOfMonth.getTime() }).catch((error)=>{
        console.log("error future risk:"+error);
        
      });
      const orders = await client.futuresUserTrades ({ startTime: startOfMonth.getTime(), endTime: endOfMonth.getTime() }).catch((error)=>{
        console.log("error future risk:"+error);
        
      });
      const allOrders = await client.futuresAllOrders ({ startTime: startOfMonth.getTime(), endTime: endOfMonth.getTime() }).catch((error)=>{
        console.log("error future risk:"+error);
        
      });
      
      
      // Calculate the user's PNL for the current month
      try{
             for (const trade of orders) {
        
            fullTrades.push(trade);
               const price = parseFloat(trade.price);
              const quantity = parseFloat(trade.qty);
                const commission = parseFloat(trade.commission);
            const isBuy = trade.buyer;
        // const profitOrLoss = isBuy ? price * quantity - commission : -price * quantity - commission;
                const profitOrLoss =parseFloat(trade.realizedPnl) - commission ;
        
               pnl += profitOrLoss;
      }
    } catch (err) {
      console.error(err);
      return "error";
    }
      for (const order of allOrders) {
        
        fullOrders.push(order);
      
      }
      for (const order of transactions) {
        
        fullTransactions.push(order);
      
      }
      
      startOfMonth.setDate(startOfMonth.getDate() + 7);
      endOfMonth.setDate(endOfMonth.getDate() + 7);
       
   
    }
    const balance =await client.futuresAccountBalance().catch((error) => {
      
    console.error("balance error:"+error);
   
   
  });
         
  
     
      
    return {"trades":fullTrades,
    "pnl":pnl,
    "fullOrders":fullOrders,
    "balance":balance,
    "fullTransactions":fullTransactions,
  };
  
    } catch (err) {
      console.error(err);
      return "error";
    }
  }
  async function userPositionHistory(key,secret,fromYear,fromMonth,fromDay,toYear,toMonth,toDay) {
    try {
      const client = Binance({
        apiKey: key,
        apiSecret: secret
      });
      
      let startDate = new Date(fromYear, fromMonth-1, fromDay);
      let endDate = new Date(toYear, toMonth-1 , toDay*1+1, 0, 0, -1);
  
      let startOfMonth = startDate;
      let endOfMonth = new Date(fromYear, fromMonth-1 , fromDay*1+7, 0, 0, -1);
     
      let positionHistory=[];
      
      let pnl = 0;
   while(startOfMonth<endDate){   
  
    
    
    const now = new Date();
    if(startOfMonth>now){
     console.log("break");
      break;
    }
    if(endOfMonth>now){
     
      endOfMonth=now;
    
    }
     positionHistory = await client.futuresUserTrades ({ startTime: startOfMonth.getTime(), endTime: endOfMonth.getTime() }).catch((error)=>{
      console.log("error future risk:"+error);
      
    });
      
      
      
      startOfMonth.setDate(startOfMonth.getDate() + 7);
      endOfMonth.setDate(endOfMonth.getDate() + 7);
       
   
    }
   
         
  
     
      
    return {"positionHistory":positionHistory,
    
  };
  
    } catch (err) {
      console.error(err);
      return "error";
    }
  }
  // This responds with "Hello World" on the homepage
  app.get('/', function (req, res) {
    try{
     console.log("Got a GET requestt for the homepage");
   
     
   
     res.redirect('https://skoltrade.com');
    } catch (err) {
      console.error(err);
      return "error";
    }
  })
  
  // This responds with "Hello World" on the homepage
  app.get('/closeAll', function (req, res) {
    console.log("Got a GET request for the close all");
    const trader = req.query.traderId;
    console.log("trader isssssssssss");
    console.log(trader);
    closeAllPositions(trader);
   //  copyOrder();
    res.set('Access-Control-Allow-Origin', '*');
    res.send('got close all request');
  
  })
  app.get('/closeAllSymbol', function (req, res) {
    console.log("Got a GET request for the close all");
    const trader = req.query.traderId;
    const symbol = req.query.symbol;
    
    closeSymbolPosition(trader,symbol);
   //  copyOrder();
    res.set('Access-Control-Allow-Origin', '*');
    res.send('got close all request');
  
  })
  app.get('/userPnl', async function (req, res) {
    
    try {
      const key = req.query.key;
      const secret = req.query.secret;
      const fromYear =req.query.fromYear;
      const fromMonth =req.query.fromMonth;
      const fromDay =req.query.fromDay;
      const toYear =req.query.toYear;
      const toMonth =req.query.toMonth;
      const toDay =req.query.toDay;
  
      const result = await userPnl(key, secret,fromYear,fromMonth,fromDay,toYear,toMonth,toDay);
      
    
      res.set('Access-Control-Allow-Origin', '*');
      res.send(result);
      
    } catch (error) {
      console.error(error);
      res.set('Access-Control-Allow-Origin', '*');
      res.status(500).send('An error occurred');
    }
  })
  app.post('/userPnl', async function (req, res) {
    
    try {
      const key = req.body.key;
      const secret = req.body.secret;
      const fromYear =req.body.fromYear;
      const fromMonth =req.body.fromMonth;
      const fromDay =req.body.fromDay;
      const toYear =req.body.toYear;
      const toMonth =req.body.toMonth;
      const toDay =req.body.toDay;
  
      const result = await userPnl(key, secret,fromYear,fromMonth,fromDay,toYear,toMonth,toDay);
      
    
      res.set('Access-Control-Allow-Origin', '*');
      res.send(result);
      
    } catch (error) {
      console.error(error);
      res.set('Access-Control-Allow-Origin', '*');
      res.status(500).send('An error occurred');
    }
  })
  app.get('/openOrdersAndPositions', async function (req, res) {
    
    try {
      const key = req.query.key;
      const secret = req.query.secret;
     
      const result = await openOrdersAndPositions(key, secret);
      
    
      res.set('Access-Control-Allow-Origin', '*');
      res.send(result);
    } catch (error) {
      console.error(error);
      res.set('Access-Control-Allow-Origin', '*');
      res.status(500).send('An error occurred');
    }
  })
  app.post('/openOrdersAndPositions', async function (req, res) {
    
    try {
      const key = req.body.key;
      const secret = req.body.secret;
     
      const result = await openOrdersAndPositions(key, secret);
      
    
      res.set('Access-Control-Allow-Origin', '*');
      res.send(result);
    } catch (error) {
      console.error(error);
      res.set('Access-Control-Allow-Origin', '*');
      res.status(500).send('An error occurred');
    }
  })
  function generateSignature(body,data) {
    try{
    const merchantSecret ="sglvhhsh0vmx3umwmcsp1dldcpmcszbkwzvqhwym3mbx232it96nwmll4hatebqz";
    const timestamp = data.timestamp.toString();
    const payload = `${timestamp}\n${data.nonce}\n${body}\n`;
    const bytes = Buffer.from(payload, 'utf-8');
    const key = Buffer.from(merchantSecret, 'utf-8');
    const hmac = crypto.createHmac('sha512', key);
    hmac.update(bytes);
    const digest = hmac.digest();
    const signature = digest.toString('hex').toUpperCase();
   console.log(signature);
    return signature;
    res.send(result);
  } catch (error) {
    console.error(error);
    
  }
  }
  
  function hex(bytes) {
    const buffer = [];
    for (let i = 0; i < bytes.length; i++) {
      buffer.push(bytes[i].toString(16).padStart(2, '0'));
    }
    return buffer.join('');
  }
  app.post('/binanceWithDraw', async function (req, res) {
    
    // res.set('Access-Control-Allow-Origin', '*');
    // res.send("responseData");
      try {
  
        const url = "https://bpay.binanceapi.com/binancepay/openapi/payout/transfer";
    
        const body = JSON.stringify(req.body.data);
        const data=req.body;
        console.log(body);
        console.log(data);
     
        const signature = generateSignature(body,req.body);
    
        const headers = {
          "Content-Type": "application/json",
          "X-Merchant-Id": data.merchantId,
          "BinancePay-Timestamp": data.timestamp,
          "BinancePay-Nonce": data.nonce,
          "Nonce": data.nonce,
          "BinancePay-Signature": signature,
          "BinancePay-Certificate-SN": data.apiKey
        };
        import('node-fetch').then(async (module) => {
          const fetch = module.default;
          const response = await fetch(url, {
            method: 'POST',
            headers,
            body
          });
      
          const responseData = await response.json();
          console.log("binance withdraw response");
          console.log(responseData);
  
          if(responseData.status=="SUCCESS"){
            await db.collection("walletWithdrawal").add({
              "userId":data.userId,
              "amount":req.body.data.totalAmount,
              "time":FieldValue.serverTimestamp(),
              "status":true
            }).catch((error)=>{
              console.log("futuresCancelOrders error:  "+error);
             });
             await db.collection("users").doc(data.userId).update({
              'wallet':admin.firestore.FieldValue.increment(-1*parseFloat(req.body.data.totalAmount))
              });
          }else{
            db.collection("walletWithdrawal").add({
              "userId":data.userId,
              "amount":req.body.data.totalAmount,
              "time":FieldValue.serverTimestamp(),
              "status":false
            }).catch((error)=>{
              console.log("futuresCancelOrders error:  "+error);
             });
          }
          // return { responseData };
      
      
    
    
        
      
        res.set('Access-Control-Allow-Origin', '*');
        res.send(responseData);
        });
  
    } catch (error) {
      console.error(error);
      res.set('Access-Control-Allow-Origin', '*');
      res.status(500).send('An error occurred');
    }
  })
  
  app.get('/followTrader', function (req, res) {
  
    const trader = req.query.traderId;
    const traderApi = req.query.traderApi;
    const traderSecret = req.query.traderSecret;
    const userId = req.query.userId;
  
    followTrader(trader,traderApi,traderSecret,userId);
    res.set('Access-Control-Allow-Origin', '*');
    res.send('got followTraderr request');
   
  })
  
  app.get('/closeAllUser', function (req, res) {
  
    const userId = req.query.userId;
  
    closeAllUser(userId);
    res.set('Access-Control-Allow-Origin', '*');
    res.send('got closealluser request');
  
  })
  
  app.get('/test', async function (req, res) {
    // const api = "w67031gAf3dPTuUomF2gzT2LsJA9yaC4hyz6usNouhDCRX3lQDGU8AE6xxHot6yG";
    // const secret = "0TXZ2jujlBFTx2cVOD96MfV9JNFunP6CVNoKcjZM9o9aDDatDZpoUJpfDjJHRJTh";
    // // const result =await userPositionHistory(api,secret,2023,4,1,2023,5,1);
    // const settings = await admin.firestore().collection("settings").doc("settings").get();
    // const traderIdd="admin";
    // const minimumBalance =settings.data().minimumBalance;
    // const copy = settings.data()[`copy_${traderIdd}`];
    // const copyUsers = settings.data()[`copyUsers_${traderIdd}`];
    // console.log(copy);
    // console.log(copyUsers);
  //   console.log(new Date());
  //   const query =admin.firestore().collection("users");
  
  // const users = await query.get();
  // console.log(users.docs.length);
  // console.log(new Date());
  //   if (users.docs.length>0) {
  //     users.docs.forEach(async (doc) =>{
  //       try{
       
  //       const follows = doc.data().follows;
  //       const followsLength=follows.length;
  //       console.log(`${doc.data().email}--${followsLength}--${follows.toString()}`);
  //       }
  //       catch(err){
  //         console.log(`${doc.data().email}--catchhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh`);
  
  //       }
  //     });
  //   }
    res.send('Hello POST');
   
  })
  // This responds a POST request for the homepage
  app.post('/', function (req, res) {
     console.log("Got a POST request for the homepage");
     res.send('Hello POST');
    
  })
  let clientList = [];
  app.get('/binance', async function (req, res) {
    binance();
    res.set('Access-Control-Allow-Origin', '*');
    res.status(200).send("Binance user data stream function is running."); 
  
  })
  
  
  // This responds a GET request for the /list_user page.
  app.post('/userMonthlyPnl', function (req, res) {
    const key = req.body.key;
    const secret = req.body.secret;
    const fromYear =req.body.fromYear;
    const fromMonth =req.body.fromMonth;
    const fromDay =req.body.fromDay;
    const toYear =req.body.toYear;
    const toMonth =req.body.toMonth;
    const toDay =req.body.toDay;
    const client = Binance({
      apiKey: key,
      apiSecret: secret
    });
    let startDate = new Date(fromYear, fromMonth-1, fromDay);
    let endDate = new Date(toYear,toMonth-1 ,toDay);
    console.log(startDate);
    console.log(endDate);
    client.futuresIncome({
      incomeType:"REALIZED_PNL",
      startTime:startDate.getTime(),
      endTime:endDate.getTime(),
      limit:1000
    }).then((data)=>{
      res.set('Access-Control-Allow-Origin', '*');
      res.send(data);
      console.log(data);
    });
    
  })
  app.get('/userMonthlyPnl', function (req, res) {
    // const key = req.body.key;
    // const secret = req.body.secret;
    // const fromYear =req.body.fromYear;
    // const fromMonth =req.body.fromMonth;
    // const fromDay =req.body.fromDay;
    // const toYear =req.body.toYear;
    // const toMonth =req.body.toMonth;
    // const toDay =req.body.toDay;
    const client = Binance({
      apiKey: "w67031gAf3dPTuUomF2gzT2LsJA9yaC4hyz6usNouhDCRX3lQDGU8AE6xxHot6yG",
      apiSecret: "0TXZ2jujlBFTx2cVOD96MfV9JNFunP6CVNoKcjZM9o9aDDatDZpoUJpfDjJHRJTh"
    });
    let startDate = new Date(2023, 3, 1);
    let endDate = new Date(2023,4 ,1);
    console.log(startDate);
    console.log(endDate);
    client.futuresIncome({
      incomeType:"REALIZED_PNL",
      startTime:startDate.getTime(),
      endTime:endDate.getTime(),
      limit:1000
    }).then((data)=>{
      res.set('Access-Control-Allow-Origin', '*');
      res.send(data);
      console.log(data);
    });
    
  })
  
  // This responds a GET request for abcd, abxcd, ab123cd, and so on
  app.get('/ab*cd', function(req, res) {   
     console.log("Got a GET request for /ab*cd");
     res.send('Page Pattern Match');
  })
  
  var server = app.listen(8081, function () {
     var host = server.address().address
     var port = server.address().port
    //  binance();
     console.log("Example app listening at http://%s:%s", host, port)
  })
