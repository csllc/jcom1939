
// Implements a node-serialport compatible parser for incoming messages.
// This is an implementation of a stream.Transport 
// (https://nodejs.org/api/stream.html)
// Basically it takes chunks of bytes coming in from the serial port stream
// and separates them into valid PDUs.
// The checksum and message header is removed; just the message data is 
// emitted as a 'data' event.
// e.g. the incoming bytes [ 192, 0, 3, 0, 5, 248 ]
// are emitted as a data event with [ 0, 5 ]

const Buffer = require('safe-buffer').Buffer;
const Transform = require('stream').Transform;


const MSG_TOKEN_START = 192;
const MSG_TOKEN_ESC = 219;

const MSG_START_STUFF = 220;
const MSG_ESC_STUFF = 221;

// minimum bytes in a valid incoming message
const MIN_MSG_LEN = 6;


module.exports = class Parser extends Transform {
  constructor(options) {

    options = options || {};
    super(options);

    // if (options.delimiter === undefined) {
    //   throw new TypeError('"delimiter" is not a bufferable object');
    // }

    // if (options.delimiter.length === 0) {
    //   throw new TypeError('"delimiter" has a 0 or undefined length');
    // }

    // this.delimiter = Buffer.from(options.delimiter);
    this.buffer = Buffer.alloc(0);
  }

  // Takes a buffer of bytes and splits it into chunks, 
  // each of which starts with a MSG_TOKEN_START
  // An array of these chunks is returned
  splitBuffer( buf ) {
    let chunks = [];

    // discard any bytes at the front before the START
    let position = buf.indexOf( MSG_TOKEN_START );

    if( position > 0 ) {
      // Clear the bytes before the start
      buf = buf.slice( position );
    }
    else if( position < 0 ) {
      // no START at all... invalid message
      return [];
    }

    // we know buf[0] is a start, so look for another START
    let index = 1;

    while( (position = buf.indexOf( MSG_TOKEN_START, index )) > -1) {
     
      // If there are no bytes between START bytes, don't put an empty element in the array
      // This shouldn't happen based on the protocol design anyway
      if( index === position ) {
        chunks.push( Buffer.from([]));
      }
      else {
        chunks.push( buf.slice( index-1, position ) );
      }


      // continue searching at the next byte
      index = position + 1;
    }

    if( index <= buf.length ) {
      //console.log('index:', index, 'left: ', buf.slice( index-1 ) );
      chunks.push( buf.slice( index-1 ));
    }

    return chunks;
  }

  // Remove stuff characters from a buffer of data
  // returns an array of bytes that may be shorter than
  // the buffer passed in.
  decodePdu( encoded ) {

    let values = [];

    let index = 0;

    while( index < encoded.length ) {
      if( encoded[index] === MSG_TOKEN_ESC && index < encoded.length-1 ) {
        
        if( encoded[index] === MSG_START_STUFF ){
          values.push( MSG_TOKEN_START );
        }
        else if(  encoded[index] === MSG_ESC_STUFF ){
          values.push( MSG_TOKEN_ESC );
        }

        index++;
      }
      else {
        values.push( encoded[index] );
      }

      index++;

    }

    return values;
  }

  // Called on a checksum error
  // For future use...
  onReceiveError( pdu ) {

  }

  // Called to handle a received, validated PDU.  
  onReceive( pdu ) {

    // We push it to the Transform object, which spits it out
    // the Readable side of the stream as a 'data' event
    this.push( Buffer.from( pdu.slice(3, pdu.length-1 )));

  }

  // calculate 2s complement checksum over a buffer, starting
  // with a byte index
  checksum( buf, start, length ) {

    let sum = 0;

    for( var i = start; i < start+length; i++ ) {
      sum = sum + buf[i];
    }

    return ((~sum)+1) & 0xFF;
  }

  // Required function for a Transform.  Called when a chunk of data 
  // arrives.  we have no idea what data this is, or if it is even from
  // a JCOM board.
  _transform(chunk, encoding, cb) {

    var me = this;

    // Concatenate any previous data, and split into an array of
    // encoded PDUs that start with a MSG_START byte
    let encodedPdus = this.splitBuffer( Buffer.concat([this.buffer, chunk]) );

    // Now we look through each of the encoded PDUs (which have not
    // yet been validated for length or checksum)
    encodedPdus.forEach( function( encodedPdu, pduIndex ){

      // Unstuff the PDU (remove escape codes)
      let pdu = me.decodePdu( encodedPdu );

      if( pdu.length >= MIN_MSG_LEN ) {

        // it is at least long enough to possibly be complete
        let msgLength = pdu[1]*256 + pdu[2];

        // If it's too long, truncate it.  This shouldn't really happen
        // under normal circumstances, but no reason to keep extra bytes around.
        if(pdu.length + 3 > msgLength ) {
          pdu = pdu.slice(0, msgLength+3 );
        }

        // If it (now) has the expected number of bytes...
        if( msgLength === pdu.length-3 ) {

          // check the checksum
          let checksum = me.checksum( pdu, 1, msgLength +1 );

          if( checksum === pdu[ msgLength+2 ] ) {
            // Process the received PDU
            me.onReceive( pdu );
          }
          else {
            // report an incorrect checksum
            me.onReceiveError( pdu );
          } 
        }
        else if( pduIndex === encodedPdu.length-1 ) {
          // if last PDU is incomplete, save it for later
          me.buffer = Buffer.from( encodedPdu );
        }

      }
      else if( pduIndex === encodedPdu.length-1 ) {
        // if last PDU is incomplete, save it for later
        me.buffer = Buffer.from( encodedPdu );
      }

    });

    // notify the caller that we are done processing the chunk
    cb();
  }

};

