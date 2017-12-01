
const Jcom = require('..');

let board = new Jcom();

// use with the first (maybe only) CAN transceiver on the board
let can = board.can1;

board.list()
.then( function( ports ) {

  // got a list of the ports, try to open the last one which is likely
  // the one we want
  ports = ports.slice(-1);
  console.log( 'Opening ', ports[0].comName );

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
  console.log('Listening....');

  setTimeout( function() {
    board.reset();
    process.exit(0); 
  }, 30000 );

})
.catch( function( err ) {
  // If anything goes wrong, report the error and exit
	console.error( err );
  board.reset();
  process.exit(-1);
});

