// Example script to query the CANBUS network for J1939 devices.
// Note the messageMode is set to allow address negotiation messages to come through, 
// otherwise the JCOM1939 filters them out.
// We will discover ourselves too (you should see a FOUND UNIT: 1) as long as address
// negotiation succeeds  

const Jcom = require('..');

let board = new Jcom({
  can1: {
    name: [ 0,0,0,0,0,0,0,0],
    preferredAddress: 1,
    messageMode: 2,
  }
});

// use with the first (maybe only) CAN transceiver on the board
let can = board.can1;


board.list()
.then( function( ports ) {

  // got a list of the ports, try to open the last one which is likely
  // the USB cable
  ports = ports.slice(-1);
  console.log( 'Opening ', ports[0].comName );

  can.on('address', function( status, address, msg ) {
    console.log( msg + ' (address=' + address + ')' );
  });

  // Handle each incoming message
  can.on('pgn', function( msg ) {
    // this will be a PGN 0xEE00, based on the filter we set up
    console.log( 'FOUND UNIT: ' + msg.source + ' DATA: ', msg.data );
  });

  return board.open( ports[0].comName );
})
.then( function() {
  // receive address claim messages
  return can.addFilter( 0xEE00 );

})
.then( function() {
  console.log('Sending....');

  // this will fail if the address negotiation fails
  return can.send( 59904, 255, 
     [ 0x00, 0xEE, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 ]);

})
.catch( function( err ) {
	console.error( err );
  board.reset();
  process.exit(-1);
});

// Wait 3 seconds for responses, then exit
setTimeout( function() {
  board.reset();
  process.exit(0);
}, 3000);
