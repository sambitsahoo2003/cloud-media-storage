import express from 'express';
import bodyParser from 'body-parser';
import pg from "pg";
import  path  from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { CognitoIdentityProviderClient , InitiateAuthCommand , SignUpCommand , ConfirmSignUpCommand } from '@aws-sdk/client-cognito-identity-provider';
import multer from 'multer';
import { S3Client , PutObjectCommand , GetObjectCommand ,DeleteObjectCommand} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import dotenv from 'dotenv';



const __dirname = dirname(fileURLToPath(import.meta.url));
const app=express();
const PORT =3000;
app.use(express.static(path.join(__dirname , '../public')));
app.set('views', path.join(__dirname, '../views'));
app.use(bodyParser.urlencoded({extended:true}));
dotenv.config();
const storage = multer.memoryStorage()
const upload = multer({ storage: storage })
const accessKey=process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey=process.env.AWS_SECRET_ACCESS_KEY;
const awsRegion=process.env.AWS_REGION;
const bucketName=process.env.BUCKET_NAME;


const poolData = {
  UserPoolId: process.env.AWS_USER_POOL_ID, 
  ClientId: process.env.AWS_CLIENT_ID
};

//console.log(bucketName);
const db=new pg.Client({
  user: process.env.DATABASE_USER,
  host: process.env.DATABASE_HOST,
  database: process.env.DATABASE_NAME,
  password: process.env.DATABASE_PASSWORD,
  port: 5432,
});
db.connect();


const s3Client=new S3Client({
  credentials:{
    accessKeyId: accessKey,
    secretAccessKey: secretAccessKey,
  },
  region: awsRegion
});



const cognitoClient = new CognitoIdentityProviderClient({ region: awsRegion });
var accessToken=null;
var currEmail=null;
var currPath=null;



app.get('/', (req,res) => {
  res.redirect('/home.html');
});




app.get('/dashboard', async (req,res) => {
  currPath=req.query.path;
  //console.log(req.query.path);
  const res1= await db.query("SELECT * FROM user_folders where email = $1 and path = $2", [currEmail,currPath]);
  const res2= await db.query("SELECT * FROM user_files where email = $1 and path = $2", [currEmail,currPath]);
  const folders=[];
  for(let obj of res1.rows) {
    const path=obj.path + obj.folder_name;
    var name=obj.folder_name;
    name=name.slice(0,-1);
    folders.push({folder_name: name , folder_url:`/dashboard?path=${path}` , folder_path:obj.path});
  };
  const files=[];
  for(let obj of res2.rows) {
    const key=obj.path + obj.original_file_name;
    const params={
      Bucket: bucketName,
      Key: key,
    };
    const command = new GetObjectCommand(params);
    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    //console.log(url);
    files.push({file_name: obj.original_file_name , img_url:url , img_path:obj.path , img_name:obj.modified_file_name});
    
  };
  //console.log(folders);
  res.render("dashboard.ejs",{folders:folders , files: files , path:currPath });
  //console.log(res2.rows);
});


async function deleteFile(currEmail,del_path,del_name){
  const key=del_path + del_name;
  const params={
    Bucket: bucketName,
    Key: key,
  };
  const command = new DeleteObjectCommand(params);
  const response = await s3Client.send(command);
  await db.query("DELETE FROM user_files WHERE email = $1 and modified_file_name = $2 and path = $3", [currEmail,del_name,del_path]);
}

async function deleteFolder(currEmail,del_path,del_name){
  const key=del_path + del_name;
  const params={
    Bucket: bucketName,
    Key: key,
  };
  const command = new DeleteObjectCommand(params);
  const response = await s3Client.send(command);
  await db.query("DELETE FROM user_folders WHERE email = $1 and folder_name = $2 and path = $3", [currEmail,del_name,del_path]);
}


app.get('/deletefile' , async (req,res) => {
  const del_path=req.query.path;
  const del_name=req.query.name;
  await deleteFile(currEmail,del_path,del_name);
  res.redirect(`/dashboard?path=${del_path}`);
});

app.get('/deletefolder' , async (req,res) => {
  const del_path=req.query.path;
  const del_name=req.query.name + "/";
  const folder=del_path + del_name;
  const res1= await db.query("SELECT modified_file_name,path FROM user_files where email = $1 and path LIKE $2 || '%'", [currEmail,folder]);
  const res2= await db.query("SELECT folder_name,path FROM user_folders where email = $1 and path LIKE $2 || '%'", [currEmail,folder]);
  // console.log(res1.rows);
  // console.log('########################');
  // console.log(res2.rows);
  for(let obj of res1.rows){
    await deleteFile(currEmail , obj.path , obj.modified_file_name);
  }
  
  for(let obj of res2.rows){
    await deleteFolder(currEmail , obj.path , obj.folder_name);
  }

  await deleteFolder(currEmail , del_path , del_name);
  res.redirect(`/dashboard?path=${del_path}`);
});






app.post('/handlesignin' , async (req,res) => {
    currEmail = req.body.email;
    currPath=currEmail+"/";
    const password = req.body.password;

  const params = {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: poolData.ClientId,
    AuthParameters: {
      USERNAME: currEmail,
      PASSWORD: password,
    },
  };
  try {
    const command = new InitiateAuthCommand(params);
    const response = await cognitoClient.send(command);
    accessToken=response.AuthenticationResult.AccessToken;
    res.redirect(`/dashboard?path=${currPath}`);
  } catch (error) {
    const errmsg=error.message;
    if(errmsg === "Incorrect username or password.")
    {
        res.redirect('/forms/login-form.html');
    }
    else if(errmsg === "User is not confirmed.")
    {
      res.redirect('/forms/confirm-email-form.html');
    }
  }
  
});


app.post('/handleregister' , async (req,res) => {
  currEmail = req.body.email;
  const password = req.body.password;

  const params = {
    ClientId: poolData.ClientId,
    Username: currEmail,
    Password: password,
  };

  try {
    const command = new SignUpCommand(params);
    const response = await cognitoClient.send(command);
    res.redirect('/forms/confirm-email-form.html');
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});


app.post('/handleconfirmemail' , async (req,res) => {
    const confirmationCode = req.body.confirmationCode;
  
    const params = {
      ClientId: poolData.ClientId,
      Username: currEmail,
      ConfirmationCode: confirmationCode,
    };

    try {
      const command = new ConfirmSignUpCommand(params);
      const response = await cognitoClient.send(command);
      res.redirect('/forms/login-form.html');
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
});

app.post('/upload', upload.single('sampleFile'), async (req, res) => {
  const path=req.query.path;
  const fileName=req.file.originalname;
  const key=path + fileName;
  const params={
    Bucket: bucketName,
    Body: req.file.buffer,
    Key: key,
    ContentType: req.file.mimetype
  };
  const command = new PutObjectCommand(params);
  const response = await s3Client.send(command);
  await db.query("INSERT INTO user_files (email,original_file_name,modified_file_name,path) VALUES ($1 , $2 , $3 , $4)", [currEmail,fileName,fileName,path]);
  res.redirect(`/dashboard?path=${path}`);
});

app.post('/create', async (req, res) => {
  const path=req.query.path;
  const newFolder=req.body.folderName + "/";
  const key= path + newFolder;
  //console.log(path);
  const params={
    Bucket: bucketName,
    Key: key,
  };
  const command = new PutObjectCommand(params);
  const response = await s3Client.send(command);
  await db.query("INSERT INTO user_folders (email,folder_name,path) VALUES ($1 , $2 , $3 )", [currEmail,newFolder,path]);
  res.redirect(`/dashboard?path=${path}`);
});








app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});