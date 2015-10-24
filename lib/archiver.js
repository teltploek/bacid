var fs = require('fs');
var AWS = require('aws-sdk');

//Assumes S3 credentials in environment vars AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY
AWS.config.region = 'eu-central-1';

export function archiveVideo(metadata, video) {
	/*    
    fs.writeFile("output/LAST.MP4", video.mp4, function(err) {
        if (err) {
            return console.log(err);
        }
    });
	*/

    var s3obj = new AWS.S3({
        params: {
            Bucket: 'bacid-dk',
            Key: metadata.name + '.jpg'
        }
    });

    s3obj.upload({
        Body: video.jpg
    }).on('httpUploadProgress', function(evt) {
        console.log(evt);
    }).send(function(err, data) {
        console.log(err, data)
    });
}