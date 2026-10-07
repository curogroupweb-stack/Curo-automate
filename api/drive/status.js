const {token,json}=require('../_gmail');
module.exports=async(req,res)=>{try{const t=await token(req,res);const scopes=String(t.scope||'');json(res,200,{connected:true,scope:scopes.includes('drive.readonly')||scopes.includes('/auth/drive')})}catch(e){json(res,200,{connected:false,scope:false})}}
