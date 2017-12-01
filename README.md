# NodeJS JCOM1939 Module

This module provides an interface to the [JCOM1939 USB Gateway](http://copperhilltech.com/jcom1939-monitor-sae-j1939-monitor-analyzer-and-ecu-simulator/). It is likely also compatible with the [SAE J1939 Turbo Interface Board for Raspberry Pi](http://copperhilltech.com/blog/sae-j1939-turbo-interface-board-for-raspberry-pi/).

The module implements the [device-specific serial protocol](http://copperhilltech.com/content/jCOM1939-Protocol.pdf) and is not compatible with any other device or adapter.

## Getting Started
The following assumes that [NodeJS](https://nodejs.org) is already installed.  To install this module, use
```powershell
npm install jcom1939
```

The JCOM board appears as a serial port; depending on your platform you may or may not need to install drivers.  If a serial port does not appear when you plug in the board, refer to the [board installation documents](http://copperhilltech.com/blog/connecting-the-jcomj1939usb-board-hardware/) and correct the problem.

Create a script to use the board (change the COM port number as required):

```js
const Jcom = require('jcom1939');
let board = new Jcom();

// use the first(maybe only) CAN instance on the board
let can = board.can1;

// Handle each incoming message
can.on('pgn', function( msg ) {
  console.log( 'PGN:', msg );
});

// Open the com port and configure...
board.open( 'COM3' )
.then( function() {

  // enable receipt of all PGNs
  return can.addFilter( 0x100000 );
})
.then( function() {

  console.log('Listening....');

  // listen for 5 seconds, then end the script
  setTimeout( function() {
    board.reset();
    process.exit(0); 
  }, 5000 );

})
.catch( function( err ) {
  // If anything goes wrong, report the error and exit
  console.error( err );
  board.reset();
  process.exit(-1);
});

```

Several complete examples can be found in the `example` folder.

## Configuration
The constructor accepts an object that specifies the desired configuration.
The board/ports are set up before the 'open' command resolves (so once the 
open operation is complete, the CAN interface is ready to use).

The options are as shown in the following example (if you are happy with the option,
you can omit it from the options object and the default will be used).
```
let board = new Jcom({

  // Serial port baud rate
  baudRate: 115200,

  // Determines whether board sends ACK messages in response to commands
  ack: true,

  // Heartbeat interval in milliseconds (100-5000).
  // Zero disables heartbeat
  heartbeat: 0,

  // Configuration for CAN instance 1 on the board:
  can1: {
    // The address we would like to negotiate.  If set to 254, we are in 
    // 'listen only' mode and cannot send.
    preferredAddress: 254,

    // If preferredAddress is sent, this should be set to the 8-byte NAME of the ECU
    name: [],
    
    // If preferredAddress is set, and that address is not available, we will
    // try to get an address in this range.
    addressRange: { from: 254, to: 254 },

    // Message Mode:
    // 0: Normal ECU mode
    // 1: Gateway Mode 1: report all PGNs including global address
    // 2: Gateway Mode 2: Mode 1 plus reports protocol PGNs
    messageMode: 0,
  },

  // On dual-port boards, include configuration options similar to the above can1 options
  can2: null
});
```

## Events
The board object emits the following events:
* `open` when the serial port is successfully opened
* `error` if an error occurs (like the serial port could not be opened)

To listen for the events, use the typical NodeJS EventEmitter pattern:
```js
  board.on('open', function(){
    console.log( 'Port opened');
  })
```

The can1 and can2 objects emit the following events:
* `address` when the address claiming status changes
* `pgn` when a PGN is received on the CAN interface

## API
  
  API functions generally return Promises, which are resolved or rejected when the request is complete.  Refer to NodeJS Promise documentation for details on how to chain requests together, detect errors, etc.
  Refer to the JCOM1939 protocol document for additional details on the use of the commands and valid parameter ranges.

  setAddress( name, preferredAddress, addressRange )
  Initiates the address claiming process (this is done for you when you open the port, but this might be useful if you need to retry the claiming procedure).
  * name is an array of 8 bytes (e.g. [0,1,2,3,4,5,6,7]) which specifies the J1939 NAME
  * preferredAddress is a number that indicates the desired ECU address (1-253). If it is set to 254, the interface goes into 'listen only' mode.
  * addressRange is an object { from: 1, to: 5}.  If these bounds are set to 254, the ECU is not arbitrary-address capable and will only try to capture the preferredAddress.  If the addressRange is set and the preferred address is not available, the ECU will attempt to capture one of the addresses in the range.

  addFilter( pgn )
  Adds one or more PGNs to the list of PGNs we can receive. 0x100000 is a special value that indicates all PGNs should be received.  You can specify a PGN (a number like 59080) or an array of PGNs [59080, 65432] 

  removeFilter( pgn )
  Removes one or more PGNs from the filter list (which were added using addFilter)

  setListenMode()
  Put the board in listen-only mode

  send( pgn, destination, data, options )
  Send a message to a destination
  * pgn is the PGN number to send
  * destination is the address where the message should be sent
  * data is an array of bytes (up to 8) containing the message data
  * options (optional) is an object containing one or more of the following:
  ** loopback: true, if the message should be looped back and received locally
  ** interval: if present, sets the recurring transmission interval for the message.  0 disables the transmission, otherwise the value is specified in milliseconds
  ** sourceAddress: if not specified, our claimed source address is used.
  ** priority: sets the priority of the message



## Development
Please note the following if you wish to update or modify this package:

* JSHINT rules are included, please lint any changes.
* Unit tests are included (run them using `npm test`).  Some unit tests require a JCOM board to be attached and will fail if it is not found. 