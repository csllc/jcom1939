
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

  return board.open( ports[0].comName );
})
.then( function() {
  console.log('Sending....');

  // this will fail if the address negotiation fails
  return can.send( 65281, 255, [0x38, 0x37, 0x36, 0x35, 0x34, 0x33, 0x32, 0x31])
  .catch( console.log.bind(console) );

})
.then( function() {
  console.log( 'success');
  board.reset();
  process.exit(0);
})
.catch( function( err ) {
	console.error( err );
  board.reset();
  process.exit(-1);
});

