User:{
    name: String, 
    userId: String, 

}

Match:{
    matchid: String, 
    userid: String,
    rmatch: String, 
    gametype: String,
    timeInterval: String,
    startDate: Date,
    endDate: Date,
    timestamp: Date,
}

GameInterval:{
    matchid: String,
    startTime: Date,
    endTime: Date,
}
Coins:{
    userId:String,
    coin: Number
}
Lotterybox:
{
    userID:String,
    lotterboxnumber: Number,
}


function match(matchid, useris, gametype, timeInterval,startDate, endDate,timStamp ){
    for(let i=0;i<matchid;i++){
        var count =0 ;
        let ,match = new Match(matchid)
        if(match gametype == "single"){
            count++;
        }
         }

         if(count == 3){
            dbb.query(insert into Macth(useris, matchid. gametype),"Grant", coin, "coins")
         }

        function lotterbox(userid, lotterboxnumbe, timeStamp){
            let lotterbox = new LotteryBox(userid, lotterybox, timsestamp )
            if(timStamp >= startDate && timeStamp <= endDate){
                dbb.query(insert into llotterybox(userID, lotterboxnumber), "Grant a loot box")
        }
    }
    function algrbramatch(matchid, userid, timeInterval, timeInterval, startTime, endTime){
        let match = new Match(match, userid, time setInterval, startDate, endDate, timeStamp)
        let count =0;
        if(matchid == 2){
            count++;
            if(startTime >=0 && endTime<=3600 ){
                db.
            } 
        }


}