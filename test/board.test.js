

const assert = require('chai').assert;
const sinon = require('sinon');

const Jcom = require('..');

let board = new Jcom();
let can = board.can1;
let port;

const TEST_PGN1 = 50000;


function delay(ms) {
  return function(x) {
    return new Promise(resolve => setTimeout(() => resolve(x), ms));
  };
}

// Run before all tests.  Find and open the serial port
// before continuing
before( function(done) {
  
  board.list()
  .then( function (ports) {

    // take the last one in the list, which is likely to be the USB
    // port we want.
    ports = ports.slice(-1);

    // save so we can re-use
    port = ports[0].comName;    

    // open and set up the board connection
    board.open( port )
    .then( done )
    .catch( done );
    
  })
  .catch( done );
});

// Run after all tests, to clean up
after(function( done ) {
  board.reset()
  .then( function() {
    return board.close();
  })
  .then( done )
  .catch( done );
});


describe.skip( 'Board Communication Tests', function() {


  before( function( done ) {
    board.setOptions({});

    board.configure()
    .then( function() { done(); })
    .catch( function(err) { done(err); } );
  });


  it('Should reset the gateway', function(done) {
    board.reset()
    .then( done )
    .catch( done ); 
  });

});

describe.skip( '_decodeRxData', function() {

  before( function( done ) {
    board.setOptions({});
    board.configure()
    .then( function() { done(); })
    .catch( done );
  });


 it('Decode a 0-byte data message', function(done) {
    
    let msg = board._decodeRxData( Buffer.from([ 
      0x04, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06
    ]) );

    assert( msg.pgn === 0x010203 );
    assert( msg.destination === 0x04 );
    assert( msg.source === 0x05 );
    assert( msg.priority === 0x06 );
    assert.deepEqual( msg.data, Buffer.from([]));
    done();
  });

  it('Decode a 1-byte data message', function(done) {
    
    let msg = board._decodeRxData( Buffer.from([ 
      0x04, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x0A 
    ]) );

    assert( msg.pgn === 0x010203 );
    assert( msg.destination === 0x04 );
    assert( msg.source === 0x05 );
    assert( msg.priority === 0x06 );
    assert.deepEqual( msg.data, Buffer.from([ 0x0A ]));
    done();
  });

  it('Decode an 8-byte data message', function(done) {
    
    let msg = board._decodeRxData( Buffer.from([ 
      0x04, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 
      0x0A, 0x0B, 0x0C, 0x0D, 0x0e, 0x0f, 0x10, 0x11 
    ]) );

    assert( msg.pgn === 0x010203 );
    assert( msg.destination === 0x04 );
    assert( msg.source === 0x05 );
    assert( msg.priority === 0x06 );
    assert.deepEqual( msg.data, Buffer.from([ 0x0A, 0x0B, 0x0C, 0x0D, 0x0e, 0x0f, 0x10, 0x11 ]));
    done();
  });

  it('Decode a 1785-byte data message', function(done) {
    
    let buf = new Buffer( 1785 + 7);
    buf.fill( 0x55 );

    let msg = board._decodeRxData( buf );
    assert( msg.data.length === 1785 );
    done();
  });
});

describe( 'heartbeat', function() {

  before( function( done ) {
    board.setOptions({});
    board.configure()
    .then( function() { done(); })
    .catch( done );
  });


  it('Can turn heartbeat off', () => {

    this.timeout(5000);

    const spy = sinon.spy();

    board.setHeart(0)
    .then( function() {
      board.on('heartbeat', spy);

      setTimeout( function() {
        assert( spy.callCount === 0 );
        done();
      }, 3500 );

    })
    .catch( function( err ) {
      done( err );
    });
    
  });


  it('Can turn heartbeat on', () => {

    this.timeout(2000);

    const spy = sinon.spy();

    board.setHeart(100)
    .then( function() {
      board.on('heartbeat', spy);

      setTimeout( function() {
        assert( spy.callCount === 10 );
        done();
      }, 1000 );

    })
    .catch( function( err ) {
      done( err );
    });
  
  });

});


describe( 'Send packets', function() {

  before( function( done ) {
    board.setOptions({
      can1: {
        preferredAddress: 1,
        name: [ 0,0,0,0,0,0,0,0 ]
      }
    });
    board.configure()
    .then( function() { done(); })
    .catch( done );
  });


  it('Single without loopback', function(done) {
    
    const spy = sinon.spy();

    can.on('pgn', spy );

    can.addFilter( TEST_PGN1 )
    .then( function(){
      return can.send( TEST_PGN1, [] );

    })
    .then( delay( 1000 ))
    .then( function(){
      assert( spy.callCount === 0 );

    })
    .then( done )
    .catch( done ); 
  });

  it('Single with loopback', function(done) {
    
    const spy = sinon.spy();

    can.on('pgn', spy );

    can.addFilter( TEST_PGN1 )
    .then( function(){
      return can.send( TEST_PGN1, 255, [], { loopback: true } );

    })
    .then( delay( 500 ))
    .then( function(){
      
      assert( spy.callCount === 1 );
      
      assert.deepEqual(spy.getCall(0).args[0], {
        pgn: TEST_PGN1,
        destination: 255,
        source: 1,
        priority: 4,
        data: Buffer.from([])
      });


    })
    .then( done )
    .catch( done ); 
  });

  it('Periodic with loopback', function(done) {
    
    const spy = sinon.spy();
    const testArray = [2,3,4,5,6,7,8,9];

    can.on('pgn', spy );

    can.addFilter( TEST_PGN1 )
    .then( function(){
      return can.send( TEST_PGN1, 255, testArray, { loopback: true, interval: 100 } );

    })
    .then( delay( 550 ))
    .then( function(){
      
      assert( spy.callCount === 5 );
      
      assert.deepEqual(spy.getCall(0).args[0], {
        pgn: TEST_PGN1,
        destination: 255,
        source: 1,
        priority: 4,
        data: Buffer.from(testArray)
      });


    })
    .then( done )
    .catch( done ); 
  });
});

