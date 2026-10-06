/** Owns one track's asynchronous recovery and its rolling retry budget. */
export class AudioPreviewRecovery {
  private generation=0;
  private active: number | null=null;
  private rounds: number[]=[];
  blocked=false;
  get busy() { return this.active!==null; }
  begin(now:number):number|null {
    if(this.busy || this.blocked) return null;
    this.rounds=this.rounds.filter(t=>now-t<60000);
    if(this.rounds.length>=2){this.blocked=true;return null;}
    this.rounds.push(now);this.active=++this.generation;return this.active;
  }
  valid(token:number) { return this.active===token && !this.blocked; }
  cancel() {this.active=null;this.generation++;}
  finish(token:number) {if(this.valid(token))this.active=null;}
  fail(token:number) {if(this.valid(token)){this.cancel();this.blocked=true;}}
  retry() {this.cancel();this.rounds=[];this.blocked=false;}
}
