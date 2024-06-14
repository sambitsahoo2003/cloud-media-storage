function ImageUpload(){
    const val=document.getElementById('ImageUploadForm').hidden;
    var buttonText='Upload an Image';
    if(val){
        buttonText='Cancel'
    }
    document.getElementById('uploadFileButton').innerHTML=buttonText;
    document.getElementById('ImageUploadForm').hidden=(!val);
}

function createFolder(){
    const val=document.getElementById('CreateFolderForm').hidden;
    var buttonText='Create a Folder';
    if(val){
        buttonText='Cancel'
    }
    document.getElementById('createFolderButton').innerHTML=buttonText;
    document.getElementById('CreateFolderForm').hidden=(!val);
}