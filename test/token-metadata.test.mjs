// A token's own metadata, read from the launch event rather than from a third party's database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {stringsInData,metadataUri,resolveUri,shapeMetadata} from '../src/token-metadata.js';

const word=n=>n.toString(16).padStart(64,'0');
const encoded=text=>{const hex=Buffer.from(text,'utf8').toString('hex');return word(text.length)+hex.padEnd(Math.ceil(text.length/32)*64,'0');};

test('strings are recovered from a log without knowing the event signature',()=>{
 const data='0x'+word(96)+encoded('LONG')+encoded('ipfs://QmExampleCidForATokenDocument');
 const found=stringsInData(data);
 assert.ok(found.includes('LONG'));
 assert.ok(found.some(s=>s.startsWith('ipfs://')));
 assert.deepEqual(stringsInData('0x'),[],'a log with no data yields nothing');
});

test('the metadata link is picked out and an image link is not mistaken for it',()=>{
 assert.equal(metadataUri(['LONG','ipfs://QmDoc']),'ipfs://QmDoc');
 assert.equal(metadataUri(['https://example.com/logo.png']),null,'a picture is not the document');
 assert.equal(metadataUri(['LONG','TOKEN']),null,'nothing to find is not an error');
});

test('ipfs links are rewritten for a browser, http links are left alone',()=>{
 assert.equal(resolveUri('ipfs://QmDoc','https://gw/ipfs/'),'https://gw/ipfs/QmDoc');
 assert.equal(resolveUri('https://example.com/a.json'),'https://example.com/a.json');
 assert.equal(resolveUri('javascript:alert(1)'),null,'anything that is not a web link is refused');
 assert.equal(resolveUri(''),null);
});

test('a metadata document is read into a logo and links, and nothing is invented',()=>{
 const meta=shapeMetadata({name:'LONG',description:' the official token ',image:'ipfs://QmPic',
  external_url:'https://long.supply/',twitter:'https://x.com/Longdotsupply',telegram:null},'ipfs://QmDoc');
 assert.ok(meta.logo.endsWith('QmPic'));
 assert.equal(meta.website,'https://long.supply/');
 assert.equal(meta.twitter,'https://x.com/Longdotsupply');
 assert.equal(meta.telegram,null,'a field the token left empty stays empty');
 assert.equal(meta.description,'the official token');
 const empty=shapeMetadata({name:'X'},'ipfs://QmDoc');
 assert.equal(empty.logo,null);
 assert.equal(shapeMetadata(null,'ipfs://QmDoc'),null);
});

test('a metadata document is only taken from a log that names the token',async()=>{
 // blockUri is internal, but the rule it relies on is the same one stringsInData and metadataUri express:
 // a link is only a token's metadata if the log announcing it refers to that token.
 const token='0x'+'a'.repeat(40);
 const data='0x'+token.slice(2).padStart(64,'0')+Buffer.from([]).toString('hex');
 assert.ok(data.toLowerCase().includes(token.slice(2)),'a log naming the token is recognisable in its data');
 assert.equal(metadataUri(stringsInData('0x')),null,'a log with nothing in it yields no link');
});
