(function($, window){
    
    // 插件定义
    $.fn.Search = function (_aoConfig) {
        // 默认参数，可被重写
        var defaults = {
            allGameData : null,
            nextData : null,
            tabGameType: 99,
            curGameType: 1,
            curPid: null,
            curIndexarr: [0,3,4],
            curIndex:0,
            arrow: 137
        };
        
        var _mindexarr = [0,1,2,3];
        var _pindexarr = [0,3,4];
        
        var _oSelf = this,
            $this = $(this);
            
        // 插件配置
        this.oConfig = $.extend(defaults, _aoConfig);
        
        // 初始化函数
        var _init = function(){
            // 事件绑定
            _loadEvent();
        }
        // 私有函数
        var _loadEvent = function (){
            
            $(document).click(function(){
                $this.find(".main-search-bottom").hide();
            });
            
            $this.click(function(event){
                event.stopPropagation();
            });
            
            
            //点击搜索框
            $this.find(".main-search-top").find(".main-search-item").click(function(){
                var _index = $(this).index();
                var dataflag = $(this).attr("data-flag");
                _clickInput(dataflag,_index);
            });
            
            //点击游戏类型
            $this.find(".seaname").find(".gametype").find("li").click(function(){
                $(this).addClass("on").siblings().removeClass("on");
                var id = $(this).attr("data-id");
                _oSelf.oConfig.tabGameType = id;
                _loadTypeGame();
                $this.find(".az-list").find(".all-tags").trigger("click");
                var _value = $this.find(".seaname").find(".vaguesea-input").val();
                if(_value){
                    _vagueGameName(_value);
                }
            });
            
            
            //点击A-Z
            $this.find(".seaname").find(".az-list").find("li").click(function(){
                $(this).addClass("on").siblings().removeClass("on");
                var id = $(this).attr("data-id");
                _loadAzGame(id);
            });
            
            //模糊搜索
            $this.find(".seaname").find(".vaguesea-input").keyup(function(){
                $this.find(".az-list").find(".all-tags").trigger("click");
                var _value = $(this).val();
                _vagueGameName(_value);
            });
            
            //选择游戏
            $this.find(".seaname").find(".mainsearch-list").on("click","span",function(){
                var pid = $(this).attr("data-id");
                var curpid = $(".main-search-top").find(".main-search-item").eq(_oSelf.oConfig.curIndexarr[_oSelf.oConfig.curIndex]).find("input[type='hidden']").val();
                if(pid !== curpid){
                    var curGameType =  $(this).attr("data-type");
                    var curName =  $(this).text();
                    _loadNextData(pid,_oSelf.oConfig.curIndex,curName,curGameType);
                }else{
                    _oSelf.oConfig.curIndex = _oSelf.oConfig.curIndex+1;
                    _arrowMove(_oSelf.oConfig.curIndex);
                    $(".main-search-con").find(".mainsearch-item").eq(_oSelf.oConfig.curIndexarr[_oSelf.oConfig.curIndex]).show().siblings().hide();
                }
            });
            
            //选择下级数据
            $this.find(".mainsearch-item").not(".seaname").find(".mainsearch-list").on("click","span",function(){
                var pid = $(this).attr("data-id");
                var curpid = $(".main-search-top").find(".main-search-item").eq(_oSelf.oConfig.curIndexarr[_oSelf.oConfig.curIndex]).find("input[type='hidden']").val();
                if(pid !== curpid){
                    var curName =  $(this).text();
                    _loadNextData(pid,_oSelf.oConfig.curIndex,curName);
                }else{
                    if(_oSelf.oConfig.curGameType == 0 && _oSelf.oConfig.curIndex < 3 || _oSelf.oConfig.curGameType != 0 && _oSelf.oConfig.curIndex < 2 ){
                        _oSelf.oConfig.curIndex = _oSelf.oConfig.curIndex+1;
                        _arrowMove(_oSelf.oConfig.curIndex);
                        $(".main-search-con").find(".mainsearch-item").eq(_oSelf.oConfig.curIndexarr[_oSelf.oConfig.curIndex]).show().siblings().hide();
                    }else{
                        $(".main-search-bottom").hide();
                    }
                    
                }
            });
            
            //选择全部
            $this.find(".mainsearch-item").not(".seaname").find(".alls").click(function(){
                var _index  = $(this).parents(".mainsearch-item").index();
                _reset(_index)
                $(".main-search-bottom").hide();
            });
            
        };
        
        // 首次加载所有游戏数据
        var _loadallGame = function () {
            _oSelf.oConfig.LoadallGame(function(data) {
                _oSelf.oConfig.allGameData = data;
                var mapGame = new Map()
				for(let item of data.object){
					mapGame.set(item.id,item)
				}
				// 去重游戏数组
				_oSelf.oConfig.allGameFilterData = [...mapGame.values()]
                $(".all-tags").addClass("on").siblings(".hot-tags").removeClass("on")
                var _arr = '';
                for(j = 0,len=_oSelf.oConfig.allGameFilterData.length; j < len; j++) {
                    var li = '<li><span data-id="'+_oSelf.oConfig.allGameFilterData[j].id+'" data-type="'+_oSelf.oConfig.allGameFilterData[j].actGameType+'">'+_oSelf.oConfig.allGameFilterData[j].gameName+'</span></li>'
                    if(_oSelf.oConfig.allGameFilterData[j].isHot == 1){
                        li = '<li><span data-id="'+_oSelf.oConfig.allGameFilterData[j].id+'" data-type="'+_oSelf.oConfig.allGameFilterData[j].actGameType+'">'+_oSelf.oConfig.allGameFilterData[j].gameName+'<img src="//static.zhanghaodaren.com/zhdrpc/images/common/hot.gif" alt=""></span></li>'
                    }
                    _arr += li;
                };
                
                $(".mainsearch-item[data-flag='seaGamename']").find(".mainsearch-list").find("ul").html(_arr);
                $(".mainsearch-item[data-flag='seaGamename']").show().siblings().hide();
                $(".main-search-bottom").show();
            });
        };
        
        //按照游戏类型加载游戏
        var _loadTypeGame = function () {
            var gameTypeId = _oSelf.oConfig.tabGameType;
            var _arr = '';
            if(gameTypeId=='99'){
                for(j = 0,len=_oSelf.oConfig.allGameFilterData.length; j < len; j++) {
                    _arr += '<li><span data-id="'+_oSelf.oConfig.allGameFilterData[j].id+'" data-type="'+_oSelf.oConfig.allGameFilterData[j].actGameType+'">'+_oSelf.oConfig.allGameFilterData[j].gameName+'</span></li>'
                };
            }else{
                for(j = 0,len=_oSelf.oConfig.allGameData.object.length; j < len; j++) {
                    if(_oSelf.oConfig.allGameData.object[j].gameType == gameTypeId){
                        _arr += '<li><span data-id="'+_oSelf.oConfig.allGameData.object[j].id+'" data-type="'+_oSelf.oConfig.allGameData.object[j].actGameType+'">'+_oSelf.oConfig.allGameData.object[j].gameName+'<img src="//static.zhanghaodaren.com/zhdrpc/images/common/hot.gif" alt=""></span></li>'
                    }
                };
                
            }
            if(_arr == ""){
                $(".seaname").find(".mainsearch-list").find("ul").hide();
                $(".seaname").find(".mainsearch-list").find(".no-game").show();
            }else{
                $(".seaname").find(".mainsearch-list").find("ul").html(_arr).show();
                $(".seaname").find(".mainsearch-list").find(".no-game").hide();
            }
        };
        
        //按照首字母加载游戏
        var _loadAzGame = function (id) {
            var gameTypeId = _oSelf.oConfig.tabGameType;
            var _arr = '';
            if(gameTypeId == "99"){
                if(id=='all'){
                    for(j = 0,len=_oSelf.oConfig.allGameFilterData.length; j < len; j++) {
                        var li = '<li><span data-id="'+_oSelf.oConfig.allGameFilterData[j].id+'" data-type="'+_oSelf.oConfig.allGameFilterData[j].actGameType+'">'+_oSelf.oConfig.allGameFilterData[j].gameName+'</span></li>'
                        if(_oSelf.oConfig.allGameFilterData[j].isHot == 1){
                            li = '<li><span data-id="'+_oSelf.oConfig.allGameFilterData[j].id+'" data-type="'+_oSelf.oConfig.allGameFilterData[j].actGameType+'">'+_oSelf.oConfig.allGameFilterData[j].gameName+'<img src="//static.zhanghaodaren.com/zhdrpc/images/common/hot.gif" alt=""></span></li>'
                        }
                        _arr += li;
                    };
                }else if(id=='hot'){
                    for(j = 0,len=_oSelf.oConfig.allGameFilterData.length; j < len; j++) {
                        if(_oSelf.oConfig.allGameFilterData[j].isHot == 1){
                            _arr += '<li><span data-id="'+_oSelf.oConfig.allGameFilterData[j].id+'" data-type="'+_oSelf.oConfig.allGameFilterData[j].actGameType+'">'+_oSelf.oConfig.allGameFilterData[j].gameName+'</span></li>'
                        }
                    };
                }else{
                    for(j = 0,len=_oSelf.oConfig.allGameFilterData.length; j < len; j++) {
                        if(_oSelf.oConfig.allGameFilterData[j].firstLetter == id){
                            _arr += '<li><span data-id="'+_oSelf.oConfig.allGameFilterData[j].id+'" data-type="'+_oSelf.oConfig.allGameFilterData[j].actGameType+'">'+_oSelf.oConfig.allGameFilterData[j].gameName+'</span></li>'
                        }
                    };
                }
            }else{
                if(id=='all'){
                    for(j = 0,len=_oSelf.oConfig.allGameData.object.length; j < len; j++) {
                        if(_oSelf.oConfig.allGameData.object[j].gameType == gameTypeId){
                            var li = '<li><span data-id="'+_oSelf.oConfig.allGameData.object[j].id+'" data-type="'+_oSelf.oConfig.allGameData.object[j].actGameType+'">'+_oSelf.oConfig.allGameData.object[j].gameName+'</span></li>'
                            if(_oSelf.oConfig.allGameData.object[j].isHot == 1){
                                li = '<li><span data-id="'+_oSelf.oConfig.allGameData.object[j].id+'" data-type="'+_oSelf.oConfig.allGameData.object[j].actGameType+'">'+_oSelf.oConfig.allGameData.object[j].gameName+'<img src="//static.zhanghaodaren.com/zhdrpc/images/common/hot.gif" alt=""></span></li>'
                            }
                            _arr += li;
                        }
                    };
                }else if(id=='hot'){
                    for(j = 0,len=_oSelf.oConfig.allGameData.object.length; j < len; j++) {
                        if(_oSelf.oConfig.allGameData.object[j].isHot == 1 && _oSelf.oConfig.allGameData.object[j].gameType == gameTypeId){
                            _arr += '<li><span data-id="'+_oSelf.oConfig.allGameData.object[j].id+'" data-type="'+_oSelf.oConfig.allGameData.object[j].actGameType+'">'+_oSelf.oConfig.allGameData.object[j].gameName+'</span></li>'
                        }
                    };
                }else{
                    for(j = 0,len=_oSelf.oConfig.allGameData.object.length; j < len; j++) {
                        if(_oSelf.oConfig.allGameData.object[j].firstLetter == id&& _oSelf.oConfig.allGameData.object[j].gameType == gameTypeId){
                            _arr += '<li><span data-id="'+_oSelf.oConfig.allGameData.object[j].id+'" data-type="'+_oSelf.oConfig.allGameData.object[j].actGameType+'">'+_oSelf.oConfig.allGameData.object[j].gameName+'</span></li>'
                        }
                    };
                }
            }
            if(_arr == ""){
                $(".seaname").find(".mainsearch-list").find("ul").hide();
                $(".seaname").find(".mainsearch-list").find(".no-game").show();
            }else{
                $(".seaname").find(".mainsearch-list").find("ul").html(_arr).show();
                $(".seaname").find(".mainsearch-list").find(".no-game").hide();
            }
            
        };
        
        //模糊搜索游戏
        var _vagueGameName = function (_value) {
            var gameTypeId = _oSelf.oConfig.tabGameType;
            var _arr = '';
            var reg = eval('/'+_value+'/i');
            if(gameTypeId == "99"){
                for(j = 0,len=_oSelf.oConfig.allGameFilterData.length; j < len; j++) {
                    if(_oSelf.oConfig.allGameFilterData[j].pinyinCodeSimple.match(reg) || _oSelf.oConfig.allGameFilterData[j].gameName.match(reg)
                        || _oSelf.oConfig.allGameFilterData[j].gameAlias.match(reg)
                    ){
                        _arr += '<li><span data-id="'+_oSelf.oConfig.allGameFilterData[j].id+'" data-type="'+_oSelf.oConfig.allGameFilterData[j].actGameType+'">'+_oSelf.oConfig.allGameFilterData[j].gameName+'</span></li>'
                    }
                };
            }else{
                for(j = 0,len=_oSelf.oConfig.allGameData.object.length; j < len; j++) {
                    if(
                        _oSelf.oConfig.allGameData.object[j].gameType == gameTypeId&&_oSelf.oConfig.allGameData.object[j].pinyinCodeSimple.match(reg)
                         || _oSelf.oConfig.allGameData.object[j].gameType == gameTypeId&&_oSelf.oConfig.allGameData.object[j].gameName.match(reg)
                            || _oSelf.oConfig.allGameData.object[j].gameType == gameTypeId&&_oSelf.oConfig.allGameData.object[j].gameAlias.match(reg)
                        ){
                        _arr += '<li><span data-id="'+_oSelf.oConfig.allGameData.object[j].id+'" data-type="'+_oSelf.oConfig.allGameData.object[j].actGameType+'">'+_oSelf.oConfig.allGameData.object[j].gameName+'</span></li>'
                    }
                };
            }
            if(_arr == ""){
                $(".seaname").find(".mainsearch-list").find("ul").hide();
                $(".seaname").find(".mainsearch-list").find(".no-game").show();
            }else{
                $(".seaname").find(".mainsearch-list").find("ul").html(_arr).show();
                $(".seaname").find(".mainsearch-list").find(".no-game").hide();
            }
        }
        
        //加载下级数据
        var _loadNextData = function (pid,index,curName,curGameType){
            
            _oSelf.oConfig.loadNextData(function(data){
                _oSelf.oConfig.curPid = pid;
                _oSelf.oConfig.nextData = data;
                
                curGameType ? _oSelf.oConfig.curGameType = curGameType :  null;
                
                if(curGameType){
                    if(_oSelf.oConfig.curGameType == 0){
                        $(".main-search-box").addClass("m-search");
                        _oSelf.oConfig.curIndexarr = _mindexarr;
                    }else{
                        $(".main-search-box").removeClass("m-search");
                        _oSelf.oConfig.curIndexarr = _pindexarr;
                    }
                }
                
                for(j = index,len=_oSelf.oConfig.curIndexarr.length; j < len; j++) {
                    var datastart = $(".main-search-top").find(".main-search-item").eq(_oSelf.oConfig.curIndexarr[j+1]).find("p").attr("data-start");
                    $(".main-search-top").find(".main-search-item").eq(_oSelf.oConfig.curIndexarr[j+1]).find("p").text(datastart);
                    $(".main-search-top").find(".main-search-item").eq(_oSelf.oConfig.curIndexarr[j+1]).find("input[type='hidden']").val("");
                };
                
                $(".main-search-top").find(".main-search-item").eq(_oSelf.oConfig.curIndexarr[_oSelf.oConfig.curIndex]).find("p").text(curName);
                $(".main-search-top").find(".main-search-item").eq(_oSelf.oConfig.curIndexarr[_oSelf.oConfig.curIndex]).find("input[type='hidden']").val(pid);

                if(_oSelf.oConfig.curGameType == 0 && index < 3 || _oSelf.oConfig.curGameType != 0 && index<2 ){
                    
                    _oSelf.oConfig.curIndex = index+1;
                    
                    _arrowMove(_oSelf.oConfig.curIndex);
                    
                    var _arr = '';
                    for(j = 0,len=_oSelf.oConfig.nextData.object.length; j < len; j++) {
                        _arr += '<li><span data-id="'+_oSelf.oConfig.nextData.object[j].id+'">'+_oSelf.oConfig.nextData.object[j].name+'</span></li>'
                    };
                    
                    $(".main-search-con").find(".mainsearch-item").eq(_oSelf.oConfig.curIndexarr[_oSelf.oConfig.curIndex]).find(".mainsearch-list").find("ul").show().html(_arr).siblings(".search-tips").hide();
                    $(".main-search-con").find(".mainsearch-item").eq(_oSelf.oConfig.curIndexarr[_oSelf.oConfig.curIndex]).show().siblings().hide();
                    
                    
                    $(".main-search-bottom").show();
                
                }else{
                    $(".main-search-bottom").hide();
                }
                
                
            },pid);
           
        };
        
        
        //点击输入框处理
        var _clickInput = function(dataflag,index){
            if($this.hasClass("m-search")){
                _oSelf.oConfig.curIndexarr = _mindexarr;
                _oSelf.oConfig.curGameType = 0;
            }else{
                _oSelf.oConfig.curIndexarr = _pindexarr;
                _oSelf.oConfig.curGameType = 1;
            }
            var curflag = 0;
            for(j = 0,len=_oSelf.oConfig.curIndexarr.length; j < len; j++) {
                if(_oSelf.oConfig.curIndexarr[j] == index){
                    curflag = j;
                }
            };
            _oSelf.oConfig.curIndex = curflag;
            if(index == 0){
                _arrowMove(_oSelf.oConfig.curIndex);
                if(!_oSelf.oConfig.allGameData && typeof(_oSelf.oConfig.allGameData)!="undefined" && _oSelf.oConfig.allGameData!=0){
                    _loadallGame();
                }else{
                    $(".mainsearch-item[data-flag='"+dataflag+"']").show().siblings().hide();
                    $(".main-search-bottom").show();
                }
            }else{
                
                if($(".main-search-item[data-flag='"+dataflag+"']").find("input[type='hidden']").val() == '' || $(".main-search-item[data-flag='"+dataflag+"']").find("input[type='hidden']").val() == '0'){
                    
                    if($this.find(".main-search-top").find(".main-search-item").eq(0).find("input[type='hidden']").val() == ''||$this.find(".main-search-top").find(".main-search-item").eq(0).find("input[type='hidden']").val() == '0'){
                        
                        _plChooseGame(dataflag,_oSelf.oConfig.curIndex);
                        
                    }else{
                        _arrowMove(_oSelf.oConfig.curIndex);
                        var prevVal = $(".main-search-top").find(".main-search-item").eq(_oSelf.oConfig.curIndexarr[curflag-1]).find("input[type='hidden']").val();
                        if(prevVal == ''||prevVal == '0'){
                            $(".mainsearch-item[data-flag='"+dataflag+"']").show().siblings().hide();
                            var prevType = $(".main-search-top").find(".main-search-item").eq(_oSelf.oConfig.curIndexarr[curflag-1]).find("p").attr("data-start");
                            $(".mainsearch-item[data-flag='"+dataflag+"']").find(".search-tips").text("请先选择游戏"+prevType+"...").show().siblings().hide();
                            $(".main-search-bottom").show();
                        }else{
                            _arrowMove(_oSelf.oConfig.curIndex);
                            $(".mainsearch-item[data-flag='"+dataflag+"']").show().siblings().hide();
                            $(".main-search-bottom").show();
                        }
                        
                    }
                    
                }else{
                    _arrowMove(_oSelf.oConfig.curIndex);
                    $(".mainsearch-item[data-flag='"+dataflag+"']").show().siblings().hide();
                    $(".main-search-bottom").show();
                    
                }
                
            }
            
        }
        
        //请选选择游戏...
        var _plChooseGame = function(dataflag,curflag){
            _arrowMove(curflag);
            $(".mainsearch-item[data-flag='"+dataflag+"']").show().siblings().hide();
            $(".mainsearch-item[data-flag='"+dataflag+"']").find(".search-tips").text("请先选择游戏...").show().siblings().hide();
            $(".main-search-bottom").show();
        }
        
        //箭头移动
        var _arrowMove = function(nextIndex){
            if(_oSelf.oConfig.curGameType == 0){
                _oSelf.oConfig.arrow = 93+(nextIndex*2);
            }else{
                _oSelf.oConfig.arrow = 137 - (nextIndex*2);
            };
            var leftNum = nextIndex*_oSelf.oConfig.arrow+60;
            $(".main-search-arrow").stop().animate({left: leftNum+"px"},500);

            
        }
        
        //重置
        var _reset = function(index){
            if(index == 0){
                $this.find(".main-search-item").each(function(){
                    var _dataStart = $(this).find("p").attr("data-start");
                    $(this).find("p").text(_dataStart);
                    $(this).find("input[type='hidden']").val("0");
                })
            }else{
                for( var j = index; j <  $this.find(".main-search-item").length; j++){
                    $this.find(".main-search-item").eq(index).each(function(){
                    var _dataStart = $this.find(".main-search-item").eq(j).find("p").attr("data-start");
                    $this.find(".main-search-item").eq(j).find("p").text(_dataStart);
                    $this.find(".main-search-item").eq(j).find("input[type='hidden']").val("0");
                })
                }
                
            }
        }

        // 启动插件
        _init();
 
        // 链式调用
        return this;        
    };
    
    // 插件结束
})(jQuery, window);