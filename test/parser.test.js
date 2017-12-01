


'use strict';
/* eslint-disable no-new */

const assert = require('chai').assert;
const sinon = require('sinon');

const Parser = require('../lib/parser');



describe('Chunker', function() {
 
  it('Single non-start byte', () => {

    const parser = new Parser();

    let chunks = parser.splitBuffer( Buffer.from([
      0x00
    ]));

    assert( chunks.length === 0 );
    
  });

  it('Single start byte', () => {

    const parser = new Parser();

    let chunks = parser.splitBuffer( Buffer.from([
      0xC0
    ]));

    assert( chunks.length === 1 );

    assert.deepEqual( chunks[0], Buffer.from([
      0xC0
    ]));

  });


  it('Single message', () => {

    const parser = new Parser();

    let chunks = parser.splitBuffer( Buffer.from([
      0xC0, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05
    ]));

    assert( chunks.length === 1 );

    assert.deepEqual( chunks[0], Buffer.from([
      0xC0, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05

    ]));

  });


  it('Two messages', () => {

    const parser = new Parser();

    let chunks = parser.splitBuffer( Buffer.from([
      0xC0, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05,
      0xC0, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B,

    ]));

    assert( chunks.length === 2 );

    assert.deepEqual( chunks[0], Buffer.from([
      0xC0, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05
    ]));

    assert.deepEqual( chunks[1], Buffer.from([
      0xC0, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B

    ]));

  });


  it('Extra byte on front', () => {

    const parser = new Parser();

    let chunks = parser.splitBuffer( Buffer.from([
      0xD9, 0xC0, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05,
    ]));

    assert( chunks.length === 1 );

    assert.deepEqual( chunks[0], Buffer.from([
      0xC0, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05
    ]));
  });
  

  it('Trailing SOM', () => {

    const parser = new Parser();

    let chunks = parser.splitBuffer( Buffer.from([
      0xC0, 0x00, 0xC0,
    ]));

    assert( chunks.length === 2 );

    assert.deepEqual( chunks[0], Buffer.from([
      0xC0, 0x00
    ]));

    assert.deepEqual( chunks[1], Buffer.from([
      0xC0
    ]));
  });

  it('Empty Buffer', () => {

    const parser = new Parser();

    let chunks = parser.splitBuffer( Buffer.from([
    ]));

    assert( chunks.length === 0 );

  });
  
});


describe('Parser', function() {

  it('Detects a short message', () => {

    const spy = sinon.spy();
    const parser = new Parser();

    parser.on('data', spy);

    parser.write(new Buffer([ 0xc0, 0x00, 0x03, 0x00, 0x05, 0xf8 ]));

    assert(spy.calledOnce);
    assert.deepEqual(spy.getCall(0).args[0], Buffer.from([0x00,0x05]));
    
  });

  it('Detects two messages', () => {

    const spy = sinon.spy();
    const parser = new Parser();

    parser.on('data', spy);

    parser.write(new Buffer([ 
      0xc0, 0x00, 0x03, 0x00, 0x05, 0xf8,
      0xc0, 0x00, 0x03, 0x00, 0x04, 0xf9,
    ]));
    
    assert(spy.calledTwice);
    assert.deepEqual(spy.getCall(0).args[0], Buffer.from([0x00,0x05]));
    assert.deepEqual(spy.getCall(1).args[0], Buffer.from([0x00,0x04]));
  });

  it('Concatenates partial messages', () => {

    const spy = sinon.spy();
    const parser = new Parser();

    parser.on('data', spy);

    parser.write( Buffer.from([ 
      0xFF, 0xFF
    ]));

    parser.write( Buffer.from([ 
      0xc0
    ]));

    parser.write( Buffer.from([ 
      0x00, 0x03, 0x00, 0x05, 0xf8,
      0xc0, 0x00, 0x03, 0x00, 0x04, 0xf9, 0xAA,
    ]));
    
    assert(spy.calledTwice);
    assert.deepEqual(spy.getCall(0).args[0], Buffer.from([0x00,0x05]));
    assert.deepEqual(spy.getCall(1).args[0], Buffer.from([0x00,0x04]));
  });

});
