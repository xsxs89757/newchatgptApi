"use strict"
import dotenv from "dotenv"
import express from "express"
import bodyParser from "body-parser";
import * as winston from "winston";
import 'winston-daily-rotate-file';
import { createRequire } from 'module'
import request from "superagent";
import { ChatGPTUnofficialProxyAPI } from 'chatgpt'

const require = createRequire(import.meta.url)
const data = require('./.accountList.json')

dotenv.config()
const app = express()
app.use(bodyParser.json({ limit: '50mb' }))
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true, parameterLimit: 1000000 }));
// 日志
const transport = new winston.transports.DailyRotateFile({
    filename: './logs/application-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    zippedArchive: false,
    maxSize: '20m',
    maxFiles: '7d'
});
const logger = winston.createLogger({
    transports: [
        transport
    ]
})

let _accessToken = null,_replyAccessToken = 0

const getAccessToken = async() => {
    const index = Math.floor((Math.random()*data.length))
    const result = await request.post('http://43.153.18.225:5000')
                    .send({u:data[index].email,p:data[index].password})
    if(result.body.code === 0){
        _accessToken = result.body.access_token
    }else{
        _accessToken = null
    }
}

const replyAccessToken = async() => {
    if(_replyAccessToken <= 3 ){
        _replyAccessToken++
        await getAccessToken()
    }
}

await getAccessToken()
setInterval( async()=>{
    await getAccessToken()
}, 4 * 60 * 60 * 1000),

app.all('*', function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "PUT,POST,GET,DELETE,OPTIONS");
    res.header("Content-Type", "application/json;charset=utf-8");
    next();
})

let clients = [];

app.get('/status', (request, response) => response.json({clients: clients.length}));

function eventsHandler(request, response) {
    const  clientId = request.query?.id
    if(!clientId){
        return res.json({ code: 1, msg: 'clientId error' })
    }
    const headers = {
      'Content-Type': 'text/event-stream',
      'Connection': 'keep-alive',
      'Cache-Control': 'no-cache'
    };
    response.writeHead(200, headers);
  
    // response.write();
  
    const newClient = {
      id: clientId,
      response
    };
  
    clients.push(newClient);
  
    request.on('close', () => {
      console.log(`${clientId} Connection closed`);
      clients = clients.filter(client => client.id !== clientId);
    });
  }
  
app.get('/events', eventsHandler);

function sendEventsToAll(text, clientId) {
    clients.forEach((client)=>{
        if(client.id === clientId){
            client.response.write(`${text}`)
        }
    })
}



app.post("/chatgpt", async (req, res) => {
    const server = req?.body?.server
    const conversationId = req?.body?.conversation_id
    const parentMessageId = req?.body?.parent_message_id
    const subject = req?.body?.subject
    const clientId = req?.body?.client_id
    if(!subject){
        return res.json({ code: 1, msg: 'subject error' })
    }
    if(_accessToken === null){
        return res.json({ code: 1, msg: 'accessToken error' })
    }
    const proxyUrl = [
        'https://chat.duti.tech/api/conversation',
        'https://gpt.pawan.krd/backend-api/conversation'
    ]
    const index = Math.floor((Math.random()*proxyUrl.length))
    try {
        const api = new ChatGPTUnofficialProxyAPI({
            accessToken: _accessToken,
            apiReverseProxyUrl: proxyUrl[index]
        })
        let response = await api.sendMessage(subject, {
            conversationId,
            parentMessageId,
            timeoutMs: 3 * 60 * 1000, 
            onProgress: (partialResponse) => {
                console.log(partialResponse.text)
                sendEventsToAll(partialResponse.text, clientId)
            }
        })
        
        sendEventsToAll("[DONE]", clientId)
        return res.json({ code: 0, msg:'success' , data: {
            content : response.text,
            conversation_id: response.conversationId,
            parent_message_id : response.parentMessageId,
            server: index
        }})
    }catch(err) {
        console.log(err)
        await replyAccessToken()
        logger.error("ERROR_TIME:"+getCurrentTime())
        logger.error("ERROR:" + err.toString())
        logger.error("--------------------------------")
        return res.json({ code: 1, msg: "服务繁忙,请重试" })
    }
})

app.listen(process.env.APP_PORT, process.env.APP_HOST_NAME, function () {
    console.log(`服务器运行在http://${process.env.APP_HOST_NAME}:${process.env.APP_PORT}`);
})

function getCurrentTime() {
    var date = new Date();//当前时间
    var month = zeroFill(date.getMonth() + 1);//月
    var day = zeroFill(date.getDate());//日
    var hour = zeroFill(date.getHours());//时
    var minute = zeroFill(date.getMinutes());//分
    var second = zeroFill(date.getSeconds());//秒
    
    //当前时间
    var curTime = date.getFullYear() + "-" + month + "-" + day
            + " " + hour + ":" + minute + ":" + second;
    
    return curTime;
}

/**
 * 补零
 */
function zeroFill(i){
    if (i >= 0 && i <= 9) {
        return "0" + i;
    } else {
        return i;
    }
}



