const {json,setCookie}=require('../_gmail');module.exports=(req,res)=>{setCookie(res,'curo_gmail','',0);json(res,200,{disconnected:true})}
