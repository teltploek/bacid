import {Router} from 'express';
import * as archiver from './../lib/archiver'

export default function() {
    var archive = Router();

    archive.get('/', (req, res) => {

        archiver.getFromArchive(function(err, data) {
            res.render('archiveOverview', {
                title: "The Archives",
                message: "From the archives",
                videos: data
            });
        });

    });

    archive.get('/:s3key', (req, res) => {

        res.render('archivedVideo', {
            title: req.params.s3key + " from the archives",
            message: req.params.s3key + " from the archives",
            videoUrl: 'http://bacid-dk.s3.amazonaws.com/' + req.params.s3key
        });

    });

    return archive;
}