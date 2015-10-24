var fs = require('fs');
var AWS = require('aws-sdk');

//Assumes S3 credentials in environment vars AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY
AWS.config.region = 'eu-central-1';

export function archiveVideo(metadata, video) {
    archiveVideoToFile(metadata, video);
}

export function getFromArchive(callback) {
    var result = [];

    new AWS.S3().listObjects({
        Bucket: 'bacid-dk'
    }).on('success', function handlePage(response) {
        //if (response.hasNextPage()) {
        //    response.nextPage().on('success', handlePage).send();
        //}
        //Returning objects on first page only

        for (var i in response.data.Contents) {
            result.push({
                url: 'http://bacid-dk.s3.amazonaws.com/' + response.data.Contents[i].Key
            });
        }

        callback(result);
    }).send();

}

export function archiveVideoToFile(metadata, video) {
    new AWS.S3().upload({
        Bucket: 'bacid-dk',
        Key: metadata.name + '.jpg',
        Body: video.jpg
    }).on('httpUploadProgress', function(evt) {
        console.log(evt);
    }).send(function(err, data) {
        console.log(err, data)
    });
}

/*
export function archiveVideoToFile(metadata, video) { 
    fs.writeFile("output/LAST.MP4", video.mp4, function(err) {
        if (err) {
            return console.log(err);
        }
    });
}
*/