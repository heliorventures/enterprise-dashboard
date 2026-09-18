// Some Tally exports declare UTF-8 but emit a legacy single-byte NBSP (A0).
// Accept only that observed exception at a character boundary. Never reinterpret
// an A0 continuation byte, fall back to a whole legacy encoding, or discard text.
class TallyUtf8Decoder {
  constructor() {
    this.decoder=new TextDecoder('utf-8',{fatal:true});
    this.remaining=0;this.lower=0x80;this.upper=0xbf;this.offset=0;
    this.count=0;this.positions=[];
  }
  diagnostics() {return {legacyNbspCount:this.count,legacyNbspByteOffsets:[...this.positions]};}
  invalid() {throw Object.assign(new TypeError('The encoded data was not valid for encoding utf-8'),{code:'ERR_ENCODING_INVALID_ENCODED_DATA'});}
  decode(input=new Uint8Array(),{stream=false}={}) {
    const parts=[];let start=0;
    for(let i=0;i<input.length;i++) {
      const byte=input[i];
      if(this.remaining) {
        if(byte<this.lower||byte>this.upper)this.invalid();
        this.remaining--;this.lower=0x80;this.upper=0xbf;
      } else if(byte===0xa0) {
        parts.push(input.subarray(start,i),Buffer.from([0xc2,0xa0]));start=i+1;
        this.count++;if(this.positions.length<8)this.positions.push(this.offset+i);
      } else if(byte<0x80) {continue;}
      else if(byte>=0xc2&&byte<=0xdf) {this.remaining=1;}
      else if(byte>=0xe0&&byte<=0xef) {
        this.remaining=2;this.lower=byte===0xe0?0xa0:0x80;this.upper=byte===0xed?0x9f:0xbf;
      } else if(byte>=0xf0&&byte<=0xf4) {
        this.remaining=3;this.lower=byte===0xf0?0x90:0x80;this.upper=byte===0xf4?0x8f:0xbf;
      } else this.invalid();
    }
    this.offset+=input.length;
    if(!stream&&this.remaining)this.invalid();
    if(parts.length) {parts.push(input.subarray(start));input=Buffer.concat(parts);}
    return this.decoder.decode(input,{stream});
  }
}
module.exports={TallyUtf8Decoder};
