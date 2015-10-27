class SoundAnalyzer {
  constructor() {
    window.AudioContext = window.AudioContext || window.webkitAudioContext;

    this.analyserContext = null;
    this.analyserNode = null;
    this.audioContext = new AudioContext();
    this.audioInput = null;
    this.audioRecorder = null;
    this.canvasWidth = null;
    this.canvasHeight = null;
    this.inputPoint = null;
    this.rafID = null;
    this.realAudioInput = null;
    this.recIndex = 0;

    //window.addEventListener('load', () => this.initAudio );
    this.initAudio();
  }

  gotStream(stream) {
    let zeroGain;

    this.inputPoint = this.audioContext.createGain();

    // Create an AudioNode from the stream.
    this.realAudioInput = this.audioContext.createMediaStreamSource(stream);
    this.audioInput = this.realAudioInput;
    this.audioInput.connect(this.inputPoint);

    // audioInput = convertToMono( input );

    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 2048;
    this.inputPoint.connect( this.analyserNode );

    this.audioRecorder = new Recorder( this.inputPoint );

    zeroGain = this.audioContext.createGain();
    zeroGain.gain.value = 0.0;
    this.inputPoint.connect( zeroGain );
    zeroGain.connect( this.audioContext.destination );
    this.updateAnalysers();
  }

  /* TODO:

  - offer mono option
  - "Monitor input" switch
  */

  saveAudio() {
      this.audioRecorder.exportWAV( () => this.doneEncoding );
      // could get mono instead by saying
      // audioRecorder.exportMonoWAV( doneEncoding );
  }

  gotBuffers( buffers ) {
      //var canvas = document.getElementById( "wavedisplay" );

      //drawBuffer( canvas.width, canvas.height, canvas.getContext('2d'), buffers[0] );

      // the ONLY time gotBuffers is called is right after a new recording is completed - 
      // so here's where we should set up the download.
      this.audioRecorder.exportWAV( () => this.doneEncoding );
  }

  doneEncoding( blob ) {
      Recorder.setupDownload( blob, "myRecording" + ((recIndex<10)?"0":"") + recIndex + ".wav");
      recIndex++;
  }

  toggleRecording( e ) {
      if (e.classList.contains("recording")) {
          // stop recording
          this.audioRecorder.stop();
          e.classList.remove("recording");
          this.audioRecorder.getBuffers( () => this.gotBuffers );
      } else {
          // start recording
          if (!this.audioRecorder)
              return;
          e.classList.add("recording");
          this.audioRecorder.clear();
          this.audioRecorder.record();
      }
  }

  convertToMono( input ) {
      var splitter = this.audioContext.createChannelSplitter(2);
      var merger = this.audioContext.createChannelMerger(2);

      input.connect( splitter );
      splitter.connect( merger, 0, 0 );
      splitter.connect( merger, 0, 1 );
      return merger;
  }

  cancelAnalyserUpdates() {
      window.cancelAnimationFrame( this.rafID );
      this.rafID = null;
  }

  updateAnalysers(time) {
    if (!this.analyserContext) {
        var canvas = document.getElementById("analyser");
        this.canvasWidth = canvas.width;
        this.canvasHeight = canvas.height;
        this.analyserContext = canvas.getContext('2d');
    }

    // analyzer draw code here
    {
        const SPACING = 3;
        const BAR_WIDTH = 1;
        var numBars = Math.round(this.canvasWidth / SPACING);
        var freqByteData = new Uint8Array(this.analyserNode.frequencyBinCount);

        this.analyserNode.getByteFrequencyData(freqByteData); 

        this.analyserContext.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
        this.analyserContext.fillStyle = '#F6D565';
        this.analyserContext.lineCap = 'round';

        var multiplier = this.analyserNode.frequencyBinCount / numBars;

        // Draw rectangle for each frequency bin.
        for (var i = 0; i < numBars; ++i) {
            var magnitude = 0;
            var offset = Math.floor( i * multiplier );
            // gotta sum/average the block, or we miss narrow-bandwidth spikes
            for (var j = 0; j< multiplier; j++)
                magnitude += freqByteData[offset + j];
            magnitude = magnitude / multiplier;
            var magnitude2 = freqByteData[i * multiplier];
            this.analyserContext.fillStyle = "hsl( " + Math.round((i*360)/numBars) + ", 100%, 50%)";
            this.analyserContext.fillRect(i * SPACING, this.canvasHeight, BAR_WIDTH, -magnitude);
        }
    }
    
    this.rafID = window.requestAnimationFrame( (time) => { this.updateAnalysers(time) });
  }

  initAudio() {
    if (!navigator.getUserMedia)
            navigator.getUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
        if (!navigator.cancelAnimationFrame)
            navigator.cancelAnimationFrame = navigator.webkitCancelAnimationFrame || navigator.mozCancelAnimationFrame;
        if (!navigator.requestAnimationFrame)
            navigator.requestAnimationFrame = navigator.webkitRequestAnimationFrame || navigator.mozRequestAnimationFrame;

    navigator.getUserMedia({
      "audio": {
        "mandatory": {
          "googEchoCancellation": "false",
          "googAutoGainControl": "false",
          "googNoiseSuppression": "false",
          "googHighpassFilter": "false"
        },
        "optional": []
      },
    }, (stream) => {
      this.gotStream(stream)
    }, function(e) {
      alert('Error getting audio');
      console.log(e);
    });
  }
}

export default function createSoundAnalyzer() {
  return new SoundAnalyzer(...arguments)
}