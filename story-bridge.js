// Reusable successful-result return contract for embedded library mini-games.
export function readStoryHost(location, parent, self) {
  if(parent===self)return null;
  const params=new URLSearchParams(location.search);
  if(params.get('storyBridge')!=='1')return null;
  try{
    const url=new URL(params.get('storyOrigin'));
    if(!['https:','http:'].includes(url.protocol)||url.origin!==params.get('storyOrigin'))return null;
    const session=params.get('storySession'),gameId=params.get('storyGameId');
    if(!session||!gameId)return null;
    return {origin:url.origin,session,gameId};
  }catch{return null;}
}
export function returnToStory(host, result, parent) {
  if(!host||result?.cleared!==true||!['A','B'].includes(result.grade)||result.ratio<.7)return false;
  parent.postMessage({type:'cat-librarian:minigame-return',version:1,
    session:host.session,gameId:host.gameId,result:{...result}},host.origin);
  return true;
}
