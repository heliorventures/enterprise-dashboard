const {SaxesParser}=require('saxes');

// Narrow Tally wire-format compatibility for the two controls confirmed in
// server exports. Keep the actual U+0004/U+0005 values; do not remove markers,
// replace them with text, or broadly suppress XML errors. Pinned to saxes 6.0.0.
class TallySourceParser extends SaxesParser {
  constructor() {super();this.tallyControls={literal4:0,literal5:0,reference4:0,reference5:0};}
  readTallyControl() {
    const code=this.chunk.charCodeAt(this.i);
    if(code!==4&&code!==5)return null;
    // Same one-code-unit position accounting as saxes getCode10/getCode11.
    // Its state machine still rejects controls in element/attribute names.
    this.prevI=this.i;this.i++;this.column++;
    this.tallyControls['literal'+code]++;
    return code;
  }
  getCode10() {return this.readTallyControl()??super.getCode10();}
  getCode11() {return this.readTallyControl()??super.getCode11();}
  parseEntity(entity) {
    const code=/^#[0-9]+$/.test(entity)?Number(entity.slice(1)):
      entity.startsWith('#x')&&/^#x[0-9a-f]+$/i.test(entity)?parseInt(entity.slice(2),16):NaN;
    if(code!==4&&code!==5)return super.parseEntity(entity);
    this.tallyControls['reference'+code]++;
    return String.fromCharCode(code);
  }
}
module.exports={TallySourceParser};
