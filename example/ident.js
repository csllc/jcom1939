
const Jcom = require('..');

let board = new Jcom({
  can1: {
    name: [ 0,0,0,0,0,0,0,0],
    preferredAddress: 1,
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
    console.log( 'PGN:', msg );
  });

  return board.open( ports[0].comName );
})
.then( function() {
  // receive all messages
  return can.addFilter( 0x100000 );
})
.then( function() {
  console.log('Sending....');

  // this will fail if the address negotiation fails
  return can.send( 59904, 255, 
    [ 0x00, 0xEE, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 ],
    { loopback: true });

})
.then( function() {
  console.log( 'success');


})
.catch( function( err ) {
	console.error( err );
  board.reset();
  process.exit(-1);
});


setTimeout( function() {
  board.reset();
  process.exit(0);
}, 500);
