var _selGameId;
var _selGameName;
var _selGtId;
var _selGameType;
var _selMobileGameType;
var _selCarrierId;
var _selGroupId;
var _selServerId;
var _selCamp;
var _gameDataInfo = {};
var _gameDataListArr = [];
var _selGroups = [];
var _selServers = [];
var _selGroupServer = true;
var _selCarrierArg = true;
var _camps = [];
var _hasCamp = false;
var gwDomain1 ="http://10.44.1.32:9114";
var gwDomain2 = typeof gwDomain !== 'undefined' ? gwDomain : '';
if (gwDomain2 != '') {
	gwDomain1 = gwDomain2;
}


$(function(){
	bindEvent();
	initListMainSearch();
	initGroupServerSearch();
});

function loadChooseValue(obj){
	$(".header-search").find(".trans").removeClass("trans");
	$(".header-search").find(".search-pop").hide();

	$(obj).find("span").addClass("trans");

	//游戏
	if($(obj).hasClass("search-gamename")){
		$('.header-search').find(".game-pop .pop-title ul li[data-type='all']").addClass("on").siblings("li").removeClass("on");
		$('.header-search').find(".game-pop .pop-tabs ul li[data-type='all']").addClass("on").siblings("li").removeClass("on");
		loadGames();
	}

	//平台
	if($(obj).hasClass("search-platform")){
		loadPlatforms();
	}

	//类目
	if($(obj).hasClass("search-gtname")){
		loadGoodsTypes();
	}

	//运营商
	if($(obj).hasClass("search-carrier")){
		loadCarriers();
	}

	//区
	if($(obj).hasClass("search-group")){
		loadGroups();
	}

	//服
	if($(obj).hasClass("search-server")){
		loadServers();
	}

	//阵营
	if($(obj).hasClass("search-camp")){
		$(".header-search").find(".camp-pop").show();
	}
}

function cancelMainSearchPop(obj){
	$(obj).find(".trans").removeClass("trans");
	$(".header-search").find(".search-pop").hide();
}


function bindEvent(){
	$(document).click(function(){
		cancelMainSearchPop(this);
	});

	//主搜下拉事件
	$(".header-search").on("click", ".chose-value", function(e){
		e.stopPropagation();
		loadChooseValue(this);
	});

	//游戏类型切换事件
	$(".header-search").on("click", ".game-pop .pop-title ul li", function(e){
		e.stopPropagation();
		$(this).addClass("on").siblings("li").removeClass("on");
		//清空搜索
		$(this).parents('.game-pop').find('.tit-search .tit-keyword').val('');
		loadGames();
	});

	//首字母TAB切换事件
	$(".header-search").on("click", ".game-pop .pop-tabs ul li", function(e){
		e.stopPropagation();
		$(this).addClass("on").siblings("li").removeClass("on");
		//清空搜索
		$(this).parents('.game-pop').find('.tit-search .tit-keyword').val('');
		loadGames();
	});

	//选择游戏事件
	$(".header-search").on("click", ".game-pop .pop-content ul li", function(e){
		e.stopPropagation();
		selectGame(this);
	});

	//选择平台事件
	$(".header-search").on("click", ".platform-pop .pop-content ul li", function(e){
		e.stopPropagation();
		selectPlatform(this);
	});

	//选择类目事件
	$(".header-search").on("click", ".gtname-pop .pop-content ul li", function(e){
		e.stopPropagation();
		selectGoodsType(this);
	});

	//选择运营商
	$(".header-search").on("click", ".carrier-pop .pop-content ul li", function(e){
		e.stopPropagation();
		selectCarrier(this);
		if (!_hasCamp && !_selGroupServer){
			redirect();
		}
	});

	//选择区
	$(".header-search").on("click", ".group-pop .pop-content ul li", function(e){
		e.stopPropagation();
		selectGroup(this);
	});

	//选择服
	$(".header-search").on("click", ".server-pop .pop-content ul li", function(e){
		e.stopPropagation();
		selectServer(this);
		if (!_hasCamp){
			redirect();
		}
	});

	//选择营地
	$(".header-search").on("click", ".camp-pop .pop-content ul li", function(e){
		e.stopPropagation();
		selectCamp(this);
		redirect();
	});

	//搜索事件
	$(".header-search").on("click", ".search-btn", function (e) {
		redirect();
	});

	$(".header-search").find(".search-pop").mousedown(function (e) {
		e.stopPropagation();
	}).mouseup(function (e) {
		e.stopPropagation();
	});

	$(".header-search").on("click", ".search-pop", function (e) {
		e.stopPropagation();
	});

	$(".header-search").find('.search-pop .pop-title .search-icon').click(function (e) {
		e.stopPropagation();
		var html = '';
		var gameType = $(".header-search").find(".game-pop .pop-title ul li[class='on']").attr("data-type");
		if (gameType != 'all') {
			$('.header-search').find(".game-pop .pop-title ul li[data-type='"+gameType+"']").removeClass("on");
			gameType = 'all';
			$('.header-search').find(".game-pop .pop-title ul li[data-type='all']").addClass("on");
		}
		var tab = $(".header-search").find(".game-pop .pop-tabs ul li[class='on']").attr("data-type");
		if(tab !='all'){
			$('.header-search').find(".game-pop .pop-tabs ul li[data-type='"+tab+"']").removeClass("on");
			tab = 'all';
			$('.header-search').find(".game-pop .pop-tabs ul li[data-type='all']").addClass("on");
		}
		var _keywords = $('.header-search').find(".game-pop .tit-search .tit-keyword").val();
		var paramObj = new Object();
		if (gameType == '1') {
			paramObj.gameType = 1;
		} else if (gameType == '0') {
			paramObj.gameType = 0;
		}else if(gameType == "10"){
            paramObj.gameType = 10;
        } else {
			paramObj.gameType = null;
		}
		paramObj.hotFlag = '';
		paramObj.key = _keywords;
		paramObj.px = '';
		var jsonStr = JSON.stringify(paramObj);
		console.log('game search param =' + jsonStr)
		$.ajax({
			url: 'https://gw.7881.com/basic/api/game-search',
			async: false,
			type: "POST",
			data: jsonStr,
			dataType: "json",
			contentType: 'application/json',
			xhrFields: {
				withCredentials: true
			},
			success: function (data) {
				if (data.code == 0 && data.body != undefined && data.body.length > 0) {
					var dataList = data.body;
					html += initGameGroupInfoHtmlByInterface(dataList,tab);
					if (html.length == 0) {
						html = "<span class=none-game>(暂无游戏)</span>";
					}
					$(".game-pop").find(".pop-content").html('<ul>' + html + '</ul>');
				} else {
					if (html.length == 0) {
						html = "<span class=none-game>(暂无游戏)</span>";
					}
					$(".game-pop").find(".pop-content").html('<ul>' + html + '</ul>');
				}
			}
		});
	});

	$(".header-search").on("click", ".search-pop .pop-title .tit-keyword", function (e) {
		e.stopPropagation();
	});
	$(".header-search").on("input", ".search-pop .pop-title .tit-keyword", function (e) {
		var html = '';
		var gameType = $(".header-search").find(".game-pop .pop-title ul li[class='on']").attr("data-type");
		if(gameType !='all'){
			$('.header-search').find(".game-pop .pop-title ul li[data-type='"+gameType+"']").removeClass("on");
			gameType = 'all';
			$('.header-search').find(".game-pop .pop-title ul li[data-type='all']").addClass("on");
		}
		var tab = $(".header-search").find(".game-pop .pop-tabs ul li[class='on']").attr("data-type");
		if(tab !='all'){
			$('.header-search').find(".game-pop .pop-tabs ul li[data-type='"+tab+"']").removeClass("on");
			tab = 'all';
			$('.header-search').find(".game-pop .pop-tabs ul li[data-type='all']").addClass("on");
		}
		var _keywords = $('.header-search').find(".game-pop .tit-search .tit-keyword").val();
		var paramObj = new Object();
		if (gameType == '1') {
			paramObj.gameType = 1;
		} else if (gameType == '0') {
			paramObj.gameType = 0;
		}else if(gameType == "10"){
			paramObj.gameType = 10;
		}else {
			paramObj.gameType = null;
		}
		paramObj.hotFlag = '';
		paramObj.key = _keywords;
		paramObj.px = '';
		var jsonStr = JSON.stringify(paramObj);
		console.log('game search param =' + jsonStr)
		$.ajax({
			url: gwDomain1+'/basic/api/game-search',
			async: false,
			type: "POST",
			data: jsonStr,
			dataType: "json",
			contentType: 'application/json',
			xhrFields: {
				withCredentials: true
			},
			success: function (data) {
				if (data.code == 0 && data.body != undefined && data.body.length > 0) {
					var dataList = data.body;
					html += initGameGroupInfoHtmlByInterface(dataList,tab);
					if (html.length == 0) {
						html = "<span class=none-game>(暂无游戏)</span>";
					}
					$(".game-pop").find(".pop-content").html('<ul>' + html + '</ul>');
				} else {
					if (html.length == 0) {
						html = "<span class=none-game>(暂无游戏)</span>";
					}
					$(".game-pop").find(".pop-content").html('<ul>' + html + '</ul>');
				}
			}
		});
	});

	//热搜词搜索
	$(".hot-search").on("click", "a", function () {
		$(".header-search").find(".search-keyword").val( $(this).attr("data-value"));
		redirect();
	});
}

function initGameGroupInfoHtmlByInterface(dataList,tab) {
	var mobileGameArr=[];
	var html='';
	$.each(dataList, function (i, item) {
		if(item.gameType=='0' || (item.gameType=='1' && $.inArray(item.alias, mobileGameArr)<0)){
			html += initGameInfoHtmlByInterface(item, tab);
		}
		if(item.gameType=='1'){
			mobileGameArr.push(item.alias);
		}
	});
	return html;
}

function initGameInfoHtmlByInterface(item, tab){
	var html='';

	var _gamename=item.gameName;
	if(null != item.alias && item.alias != ''){
		_gamename=item.alias;
	}

	if(tab == 'hot' && item.hot == 'hot') {
		html += '<li class="hot" data-gameid="' + item.gameId + '"  data-gamename="' + _gamename + '" data-gametype="' + item.gameType + '"><span>' + _gamename + '</span></li>';
	}

	if(tab == 'all' || tab == item.px){
		if(item.hot == 'hot'){
			html += '<li class="hot" data-gameid="' + item.gameId + '"  data-gamename="' + _gamename + '" data-gametype="' + item.gameType + '"><span>' + _gamename + '</span></li>';
		}else if(item.tag == 'new' || item.tag == 'NEW'){
			html += '<li class="new" data-gameid="' + item.gameId + '"  data-gamename="' + _gamename + '" data-gametype="' + item.gameType + '"><span>' + _gamename + '</span></li>';
		}else{
			html += '<li data-gameid="' + item.gameId + '"  data-gamename="' + _gamename + '" data-gametype="' + item.gameType + '"><span>' + _gamename + '</span></li>';
		}
	}
	return html;
}

//初始化选项
function initChooseDive(chooseType){
	if(chooseType=='selectGame'){
		$(".header-search").find(".search-platform").find("p em").text('');
		$(".header-search").find(".search-platform").find("p i").show();
		$(".header-search").find(".search-platform").hide();
	}

	if(chooseType=='selectGame' || chooseType=='selectPlatform'){
		$(".header-search").find(".search-gtname").find("p em").text('');
		$(".header-search").find(".search-gtname").find("p i").show();
		$(".header-search").find(".search-gtname").css("display", "flex");

		_selGtId='0';
	}

	if(chooseType=='selectGame' || chooseType=='selectPlatform' || chooseType=='selectGoodsType'){
		$(".header-search").find(".search-carrier").find("p em").text('');
		$(".header-search").find(".search-carrier").find("p i").show();
		$(".header-search").find(".search-carrier").hide();

		_selCarrierId='0';
	}

	if(_selGroupServer && (chooseType=='selectGame' || chooseType=='selectPlatform' || chooseType=='selectGoodsType' || chooseType=='selectCarrier')){
		$(".header-search").find(".search-group").find("p em").text('');
		$(".header-search").find(".search-group").find("p i").show();
		$(".header-search").find(".search-group").css("display", "flex");

		_selGroupId='0';
	}

	if(_selGroupServer && (chooseType=='selectGame' || chooseType=='selectPlatform' || chooseType=='selectGoodsType' || chooseType=='selectCarrier' || chooseType=='selectGroup')){
		$(".header-search").find(".search-server").find("p em").text('');
		$(".header-search").find(".search-server").find("p i").show();
		$(".header-search").find(".search-server").css("display", "flex");

		_selServerId='0';
	}

	if(chooseType=='selectGame' || chooseType=='selectPlatform' || chooseType=='selectGoodsType'){
		$(".header-search").find(".search-camp").find("p em").text('');
		$(".header-search").find(".search-camp").find("p i").show();
		$(".header-search").find(".search-camp").hide();

		_selCamp=undefined;
	}
}


//商品列表地址
function redirect(){
	var keyword = $(".header-search").find(".search-keyword").val();
	if (keyword!=null && keyword != undefined && keyword != '' && validateKeyIsGoodsId(keyword)){
		location.href = '/'+keyword+'.html';
		return false;
	}

	if(_selGameId==null || _selGameId=='' || _selGameId == undefined){
		alert("请选择游戏或者使用商品编码");
		return false;
	}

	if(_selGtId==null || _selGtId=='' || _selGtId == undefined){
		_selGtId='0';
	}

	if(_selGroupId==null || _selGroupId=='' || _selGroupId == undefined){
		_selGroupId='0';
	}

	if(_selServerId==null || _selServerId=='' || _selServerId == undefined){
		_selServerId='0';
	}

	if(_selCarrierId==null || _selCarrierId=='' || _selCarrierId == undefined){
		_selCarrierId='0';
	}

	var redirectUrl='/'+_selGameId+"-"+_selGtId+"-"+_selGroupId+"-"+_selServerId+"-"+_selCarrierId+".html";
	var params='';
	if(keyword !=null && keyword != undefined && keyword != ''){
		var plusEncode = encodeURIComponent("+");
		keyword = keyword.replace("+", plusEncode);
		params+='&mainSearchKeyWord='+keyword;
	}
	if(_selCamp !=null && _selCamp!=undefined && _selCamp != ''){
		params+='&camp='+_selCamp;
	}
	if(params!=''){
		params=params.substring(1, params.length);
		redirectUrl+='?'+params;
	}

	location.href = redirectUrl;
}

//游戏检索
function searchGames() {
	var _keywords = $('.header-search').find(".game-pop .tit-search .tit-keyword").val();
	if (_keywords !=null && _keywords != '' && _keywords != undefined) {
		loadGamesByKeyword(_keywords)
		return;
	}
	loadGames();
}

//选择游戏
function selectGame(obj){
	_hasCamp=false;
	_selGroupServer=true;
	var _gametype=$(obj).attr("data-gametype");
	_selGameType=_gametype;
	var _gameid=$(obj).attr("data-gameid");
	_selGameId=_gameid;
	var _gamename=$(obj).attr("data-gamename");
	_selGameName=_gamename;
	$(".header-search").find(".search-gamename").find("p em").text(_gamename);
	$(".header-search").find(".search-gamename").find("p i").hide();
	$(".header-search").find(".game-pop").hide();
	$(".header-search").find(".search-gamename span").removeClass("trans");
	$(".header-search").find(".search-keyword").val("");

	initChooseDive("selectGame");

	if(_gametype=='1'){
		loadPlatforms();
	}else{
		loadGoodsTypes();
	}
}

//选择平台
function selectPlatform(obj){
	var _gameid=$(obj).attr("data-gameid");
	_selGameId=_gameid;
	var _mobilegametype=$(obj).attr("data-mobilegametype");
	_selMobileGameType=_mobilegametype;
	$(".header-search").find(".search-platform").find("p em").text(_mobilegametype);
	$(".header-search").find(".search-platform").find("p i").hide();
	$(".header-search").find(".platform-pop").hide();
	$(".header-search").find(".search-platform span").removeClass("trans");

	initChooseDive("selectPlatform");

	loadGoodsTypes();
}

//选择类目
function selectGoodsType(obj){
	var _gtid=$(obj).attr("data-gtid");
	_selGtId=_gtid;
	var _gtname=$(obj).attr("data-gtname");
	var _gametype=$(obj).attr("data-gametype");
	$(".header-search").find(".search-gtname").find("p em").text(_gtname);
	$(".header-search").find(".search-gtname").find("p i").hide();
	$(".header-search").find(".gtname-pop").hide();
	$(".header-search").find(".search-gtname span").removeClass("trans");

	initChooseDive("selectGoodsType");

	loadGameData();

	if(_selCarrierArg){
		needSelGroupServer();
		loadCarriers();

		if (_gametype == '0') {
			loadCampsData();
		}
	}else{
		loadGroups();
		loadCampsData();
	}
}

//选择运营商
function selectCarrier(obj){
	var _carrierId=$(obj).attr("data-carrierid");
	var _carrierName=$(obj).attr("data-carriername");
	_selCarrierId=_carrierId;
	$(".header-search").find(".search-carrier").find("p em").text(_carrierName);
	$(".header-search").find(".search-carrier").find("p i").hide();
	$(".header-search").find(".carrier-pop").hide();
	$(".header-search").find(".search-carrier span").removeClass("trans");

	initChooseDive("selectCarrier");

	if(_selGroupServer){
		loadGroups();
	}
}

//选择区
function selectGroup(obj){
	var _groupId=$(obj).attr("data-groupid");
	var _groupName=$(obj).attr("data-groupname");
	_selGroupId=_groupId;
	$(".header-search").find(".search-group").find("p em").text(_groupName);
	$(".header-search").find(".search-group").find("p i").hide();
	$(".header-search").find(".group-pop").hide();
	$(".header-search").find(".search-group span").removeClass("trans");

	initChooseDive("selectGroup");

	loadServers();
}

//选择服
function selectServer(obj){
	var _serverId=$(obj).attr("data-serverid");
	_selServerId=_serverId;
	var _serverName=$(obj).attr("data-servername");
	$(".header-search").find(".search-server").find("p em").text(_serverName);
	$(".header-search").find(".search-server").find("p i").hide();
	$(".header-search").find(".server-pop").hide();
	$(".header-search").find(".search-server span").removeClass("trans");

	initChooseDive("selectServer");

	showCampPop();
}

//选择阵营
function selectCamp(obj){
	var _camp=$(obj).attr("data-camp");
	_selCamp=_camp;
	$(".header-search").find(".search-camp").find("p em").text(_camp);
	$(".header-search").find(".search-camp").find("p i").hide();
	$(".header-search").find(".camp-pop").hide();
	$(".header-search").find(".search-camp span").removeClass("trans");
}

//展示阵营
function showCampPop(){
	if(!_hasCamp){
		return;
	}

	$(".header-search").find(".search-camp span").addClass("trans");
	$(".header-search").find(".camp-pop").show();
}

function validateKeyIsGoodsId(keywords){
	var isGoodsId = false;
	if(!isNaN(keywords) && keywords.length == 15 && keywords.startsWith('2016')){
		isGoodsId =true;


		// $.ajax({
		//     type : 'post',
		//     url : '//www.7881.com/procurement/getGameByGoodsid.action',
		//     async : false,
		//     data : {
		//         g : keywords
		//     },
		//     dataType : 'json',
		//     success : function(json) {
		//         if (json.success == 'F') {
		//             return false;
		//         }
		//         isGoodsId = true;
		//     }
		// });
	}
	return isGoodsId;
}

//加载类目
function loadGoodsTypes(){
	$.each(allgames, function(i, item) {
		if (item.gameid == _selGameId) {
			html = "";
			$.each(item.splxids.split(","), function (j, list){
				var targets = list.split(":");
				html += '<li data-gtid="'+targets[0]+'" data-gtname="'+targets[1]+'" data-gametype="'+item.gametype+'"><span>'+targets[1]+'</span></li>';
			});
			$(".gtname-pop").find(".pop-content").html('<ul>'+html+'</ul>');
			return false;
		}
	});
	$(".header-search").find(".search-gtname span").addClass("trans");
	$(".header-search").find(".gtname-pop").show();
}

//加载运营商
function loadCarriers(){
	var _carriers=_gameDataInfo.carriers;
	var html='';
	$.each(_carriers, function (i, item) {
		html += '<li data-carrierid="' + item.carrierid + '" data-carriername="' + item.carriername + '"><span>' + item.carriername + '</span></li>';
	});
	$(".carrier-pop").find(".pop-content").html('<ul>'+html+'</ul>');
	$(".header-search").find(".search-carrier span").addClass("trans");
	$(".header-search").find(".search-carrier").css("display", "flex");
	$(".header-search").find(".carrier-pop").show();
}

//加载区
function loadGroups(){
	//不存在运营商
	if(!_selCarrierArg){
		var _groups=_gameDataInfo.groups;
		_selGroups=_groups;
		var html='';
		$.each(_groups, function (i, item) {
			html += '<li data-groupid="' + item.groupid + '" data-groupname="' + item.groupname + '"><span>' + item.groupname + '</span></li>';
		});
		$(".group-pop").find(".pop-content").html('<ul>'+html+'</ul>');
		$(".header-search").find(".search-group span").addClass("trans");
		$(".header-search").find(".group-pop").show();
		return;
	}

	//存在运营商
	if(_selCarrierArg){
		var _carriers=_gameDataInfo.carriers;
		var _targetCarrier=null;
		$.each(_carriers, function (i, item) {
			if(_selCarrierId==item.carrierid){
				_targetCarrier=item;
				return false;
			}
		});

		if(_targetCarrier==null){
			return;
		}

		var _groups=_targetCarrier.groups;
		_selGroups=_groups;
		var html='';
		$.each(_groups, function (i, item) {
			html += '<li data-groupid="' + item.groupid + '" data-groupname="' + item.groupname + '"><span>' + item.groupname + '</span></li>';
		});

		if(html.length==0){
			return;
		}

		$(".group-pop").find(".pop-content").html('<ul>'+html+'</ul>');
		$(".header-search").find(".search-group span").addClass("trans");
		$(".header-search").find(".search-group").css("display", "flex");
		$(".header-search").find(".group-pop").show();
		return;
	}
}

//加载服
function loadServers(){
	var _servers=null;
	$.each(_selGroups, function (i, item) {
		if(_selGroupId==item.groupid){
			_servers=item.servers;
			return false;
		}
	});

	if(_servers==null){
		return;
	}

	var html='';
	$.each(_servers, function (i, item) {
		html += '<li data-serverid="' + item.serverid + '" data-servername="' + item.servername + '"><span>' + item.servername + '</span></li>';
	});

	if(html.length==0){
		return;
	}

	$(".server-pop").find(".pop-content").html('<ul>'+html+'</ul>');
	$(".header-search").find(".search-server span").addClass("trans");
	$(".header-search").find(".search-server").css("display", "flex");
	$(".header-search").find(".server-pop").show();
}

//加载阵营
function loadCampsData(){
	$.ajax({
		url: "https://gw.7881.com/basic/api/camp/support-item?gameId="+_selGameId+"&gtId="+_selGtId,
		type: "GET",
		async: false,
		success:function(data){
			if(data.code==0){
				_camps=data.body.campAttrList;
			}else{
				_camps=[];
			}
		}
	});

	if(_camps.length==0){
		return;
	}

	var html='';
	$.each(_camps, function (i, item) {
		html += '<li data-camp="' + item + '"><span>' + item + '</span></li>';
	});
	$(".camp-pop").find(".pop-content").html('<ul>'+html+'</ul>');
	$(".header-search").find(".search-camp").css("display", "flex");
	_hasCamp=true;
}

//使用关键词检索游戏
	function loadGamesByKeyword(keywords){
		var gameType=$('.header-search').find('.game-pop .pop-title ul li[class="on"]').attr('data-type');
		var tab=$('.header-search').find('.game-pop .pop-tabs ul li[class="on"]').attr('data-type');

		var html="";
		var aliasShown=[]; // 与 loadGames 保持一致
		$.each(allgames,function(i,item){
			var txt = keywords.toLowerCase().replace(/(.)(?=[^$])/g, "$1,").split(",");
			var _txt = '';
			$.each(txt, function(i, it) {
				if(/[\u4e00-\u9fa5\d]/.test(it)) {
					_txt += Character.getPinyinOfChar(it);
				} else {
					_txt += it;
				}
			});

			if (Character.testPinyinAbbrByPinyin(getPy(item.gamename), _txt)) {
				if(gameType == '10'){
					if(item.wowGame == true){
						html+=initGameInfoHtml(item, tab);
					}
					return; // 继续下一个
				}

				if(gameType == '0'){
					if(item.gametype=='0' || (item.gametype=='1' && item.pcMobileSyncFlag==1)){
						html+=initGameInfoHtml(item, tab);
					}
					return;
				}

				if(gameType == '1'){
					var include = (item.gametype=='1') || (item.gametype=='0' && item.pcMobileSyncFlag==1);
					if(include){
						var alias = item.gamealias || item.gamename || '';
						if($.inArray(alias, aliasShown) < 0){
							html+=initGameInfoHtml(item, tab);
							aliasShown.push(alias);
						}
					}
					return;
				}

				// all：保持原有行为（端游都展示；手游按别名去重）
				if(item.gametype=='0' || (item.gametype=='1' && $.inArray(item.gamealias, aliasShown)<0)){
					html+=initGameInfoHtml(item, tab);
				}
				if(item.gametype=='1'){
					aliasShown.push(item.gamealias);
				}
			}
		});

		if(html.length==0){
			html='<span class=none-game>(暂无游戏)</span>';
		}

		$('.game-pop').find('.pop-content').html('<ul>'+html+'</ul>');
	}

	function initGameInfoHtml(item, tab){
		var html='';

		var _gamename=item.gamename;
		if(null != item.gamealias && item.gamealias != ''){
			_gamename=item.gamealias;
		}

		var syncIcon = (item.pcMobileSyncFlag == 1 ? '<i class="icon-pc-mobile-sync" title="端手同步"></i>' : '');

		if(tab == 'hot' && item.hot == 'hot') {
			html += '<li class="hot" data-gameid="' + item.gameid + '"  data-gamename="' + _gamename + '" data-gametype="' + item.gametype + '"><span>' + _gamename + '</span>' + syncIcon + '</li>';
		}

		if(tab == 'all' || tab == item.px){
			if(item.hot == 'hot'){
				html += '<li class="hot" data-gameid="' + item.gameid + '"  data-gamename="' + _gamename + '" data-gametype="' + item.gametype + '"><span>' + _gamename + '</span>' + syncIcon + '</li>';
			}else if(item.tag == 'new' || item.tag == 'NEW'){
				html += '<li class="new" data-gameid="' + item.gameid + '"  data-gamename="' + _gamename + '" data-gametype="' + item.gametype + '"><span>' + _gamename + '</span>' + syncIcon + '</li>';
			}else{
				html += '<li data-gameid="' + item.gameid + '"  data-gamename="' + _gamename + '" data-gametype="' + item.gametype + '"><span>' + _gamename + '</span>' + syncIcon + '</li>';
			}
		}

		return html;
	}

//gameType: 0,端游; 1,手游; 10,魔兽 all,全部
function loadGames(){
	var gameType=$('.header-search').find('.game-pop .pop-title ul li[class="on"]').attr('data-type');
	var tab=$('.header-search').find('.game-pop .pop-tabs ul li[class="on"]').attr('data-type');

	var html='';
	var aliasShown=[]; // 在手游筛选场景按别名去重

	$.each(allgames,function(i,item){
		if(gameType == '10'){
			if(item.wowGame == true){
				html+=initGameInfoHtml(item, tab);
			}
			return; // 继续下一个
		}

		if(gameType == '0'){
			// 端游 + 端手同步的手游
			if(item.gametype=='0' || (item.gametype=='1' && item.pcMobileSyncFlag==1)){
				html+=initGameInfoHtml(item, tab);
			}
			return;
		}

		if(gameType == '1'){
			// 手游 + 端手同步的端游；并对相同别名去重
			var include = (item.gametype=='1') || (item.gametype=='0' && item.pcMobileSyncFlag==1);
			if(include){
				var alias = item.gamealias || item.gamename || '';
				if($.inArray(alias, aliasShown) < 0){
					html+=initGameInfoHtml(item, tab);
					aliasShown.push(alias);
				}
			}
			return;
		}

		// all：保持原有行为（端游都展示；手游按别名去重）
		if(item.gametype=='0' || (item.gametype=='1' && $.inArray(item.gamealias, aliasShown)<0)){
			html+=initGameInfoHtml(item, tab);
		}
		if(item.gametype=='1'){
			aliasShown.push(item.gamealias);
		}
	});

	if(html.length==0){
		html='<span class=none-game>(暂无游戏)</span>';
	}
	$('.game-pop').find('.pop-content').html('<ul>'+html+'</ul>');
	$('.header-search').find('.search-gamename span').addClass('trans');
	$('.header-search').find('.game-pop').show();
}


//加载平台
function loadPlatforms(){
	var html='';
	var platformCnt=0;
	$.each(allgames, function (i, item) {
		if(item.gametype=='1' && item.gamealias==_selGameName){
			var _mobilegametype='';
			if(item.mobilegametype=='0'){
				_mobilegametype='苹果版';
			}
			if(item.mobilegametype=='1'){
				_mobilegametype='安卓版';
			}
			if(item.mobilegametype=='2'){
				_mobilegametype='苹果越狱';
			}
			if(item.mobilegametype=='3'){
				_mobilegametype='双平台互通';
			}
			if(item.mobilegametype=='4'){
				_mobilegametype='游戏官方';
			}
			if(_mobilegametype!=''){
				platformCnt=platformCnt+1;
				html += '<li data-gameid="' + item.gameid + '" data-mobilegametype="' + _mobilegametype + '"  data-gamename="' + item.gamename + '" data-gametype="' + item.gametype + '"><span>' + _mobilegametype + '</span></li>';
			}
		}
	});

	if(html.length==0){
		return;
	}

	$(".platform-pop").find(".pop-content").html('<ul>'+html+'</ul>');

	if(platformCnt==1){
		$(".platform-pop").find(".pop-content ul li").click();
		return;
	}

	$(".header-search").find(".search-platform span").addClass("trans");
	$(".header-search").find(".search-platform").css("display", "flex");
	$(".header-search").find(".platform-pop").show();
}


function getPy(word){
	var _pinyin;
	$.each(srcSearchWord, function(i, item) {
		if(item.text == word){
			_pinyin = item.pinyin;
			return false;
		}
	});
	return _pinyin;
}

function initListMainSearch() {
	var _goodsType = $("input[name='s_goodsTypeName']").val();
	var _gtId = $("input[name='s_gtid']").val();
	var _gameId = $("input[name='s_gameId']").val();
	var s_carrierId = $("input[name='s_carrierId']").val();
	var s_groupId = $("input[name='s_groupId']").val();
	var s_serverId = $("input[name='s_serverId']").val();
	var s_camp = $("input[name='s_camp']").val();
	var _mainSearchKeyword = $("input[name='s_mainSearchKeyWord']").val();

	var _gameInfo = null;
	if (_gameId != null && _gameId != '' && _gameId != undefined) {
		$.each(allgames, function (i, item) {
			if (item.gameid == _gameId) {
				_gameInfo = item;
				return false;
			}
		});
	}
	if (_gameInfo == null) {
		return;
	}
	_selGameId=_gameInfo.gameid;
	_selGameType = _gameInfo.gametype;
	var _gamename=null;
	if(_gameInfo.gametype=='1'){
		_gamename=_gameInfo.gamealias;
	}else{
		_gamename=_gameInfo.gamename;
	}
	_selGameName=_gamename;
	$(".header-search").find(".search-gamename").find("p em").text(_gamename);
	$(".header-search").find(".search-gamename").find("p i").hide();
	if(_gameInfo.gametype=='1'){
		var _mobilegametype=null;
		if(_gameInfo.mobilegametype=='0'){
			_mobilegametype='苹果版';
		}
		if(_gameInfo.mobilegametype=='1'){
			_mobilegametype='安卓版';
		}
		if(_gameInfo.mobilegametype=='2'){
			_mobilegametype='苹果越狱';
		}
		if(_gameInfo.mobilegametype=='3'){
			_mobilegametype='双平台互通';
		}
		if(_mobilegametype!=null){
			_selMobileGameType=_mobilegametype;

			var platformCnt=0;
			$.each(allgames, function (i, item) {
				if(item.gametype=='1' && item.gamealias==_gameInfo.gamealias){
					if(item.mobilegametype=='0' || item.mobilegametype=='1' || item.mobilegametype=='2' || item.mobilegametype=='3'){
						platformCnt=platformCnt+1;
					}
				}
			});
			if(platformCnt>1){
				$(".header-search").find(".search-platform").find("p em").text(_mobilegametype);
				$(".header-search").find(".search-platform").find("p i").hide();
				$(".header-search").find(".search-platform").css("display", "flex");
			}
		}
	}

	$.each(_gameInfo.splxids.split(","), function (j, list){
		var targets = list.split(":");
		if(targets[0]==_gtId){
			_selGtId=_gtId;
			$(".header-search").find(".search-gtname").find("p em").text(targets[1]);
			$(".header-search").find(".search-gtname").find("p i").hide();
			return false;
		}
	});

	loadGameData();

	if (_gameInfo.gametype == '0') {
		_selGroups = _gameDataInfo.groups;
		loadCampsData();
	}

	// 存在运营商
	if (_selCarrierArg) {
		$(".header-search").find(".search-carrier").css("display", "flex");
		needSelGroupServer();
		if (s_carrierId != null && s_carrierId != '' && s_carrierId != undefined) {
			$.each(_gameDataInfo.carriers, function (i, item) {
				if (item.carrierid == s_carrierId) {
					_selGroups = item.groups;
					$(".header-search").find(".search-carrier").find("p em").text(item.carriername);
					$(".header-search").find(".search-carrier").find("p i").hide();
					_selCarrierId = s_carrierId;
					return false;
				}
			});
		}
	}

	// 存在区服
	if (_selGroupServer) {
		if (s_groupId != null && s_groupId != '' && s_groupId != undefined && _selGroups != undefined) {
			$.each(_selGroups, function (i, item) {
				if (item.groupid == s_groupId) {
					_selGroupId = s_groupId;
					_selServers = item.servers;
					$(".header-search").find(".search-group").find("p em").text(item.groupname);
					$(".header-search").find(".search-group").find("p i").hide();
					return false;
				}
			});
		}
		if (s_serverId != null && s_serverId != '' && s_serverId != undefined && _selServers != undefined) {
			$.each(_selServers, function (i, item) {
				if (item.serverid == s_serverId) {
					$(".header-search").find(".search-server").find("p em").text(item.servername);
					$(".header-search").find(".search-server").find("p i").hide();
					_selServerId = s_serverId;
					return false;
				}
			});
		}
	} else {
		$(".header-search").find(".search-group").hide();
		$(".header-search").find(".search-server").hide();
	}

	if (s_camp != null && s_camp != undefined && s_camp !='') {
		$(".header-search").find(".search-camp").find("p em").text(s_camp);
		$(".header-search").find(".search-camp").find("p i").hide();
		_selCamp = s_camp;
	}

	if (_hasCamp) {
		$(".header-search").find(".search-camp").css("display", "flex");
		if (s_camp != null && s_camp != undefined && s_camp != '') {
			$.each(_camps, function (i, item) {
				if (item == s_camp) {
					_selCamp = s_camp;
					$(".header-search").find(".search-camp").find("p em").text(item);
					$(".header-search").find(".search-camp").find("p i").hide();
					return false;
				}
			});
		}
	}

	if (_mainSearchKeyword != null && _mainSearchKeyword != undefined && _mainSearchKeyword !='') {
		$(".header-search").find(".search-keyword").val(_mainSearchKeyword);
	}
}

//加载运营商&区&服
function loadGameData(){
	var gameDataLoaded = false;
	if (_gameDataListArr && _gameDataListArr.length > 0) {
		$.each(_gameDataListArr,function(i, item){
			if (item.gameid == _selGameId && typeof(item.carrier)!="undefined") {
				_gameDataInfo = item;
				_selCarrierArg = _gameDataInfo.carriers != null && _gameDataInfo.carriers.length > 0;
				gameDataLoaded = true;
				return false;
			}
		})
	}

	if(gameDataLoaded){
		return;
	}

	$.ajax({
		type: 'post',
		url: '//www.7881.com/getGameQuFuInfo.action',
		async:false,
		data: {
			gameid: _selGameId,
			gtid: _selGtId
		},
		dataType: 'json',
		success: function (json) {
			if (!json) {
				return false;
			}
			_gameDataInfo=json;
			_selCarrierArg = _gameDataInfo.carriers != null && _gameDataInfo.carriers.length > 0;
			_gameDataListArr.push(json);
		}
	});
}

function needSelGroupServer(){
	$.ajax({
		url: "https://gw.7881.com/basic/api/config/queryPublishChooseRegional?gameId="+_selGameId+"&gtId="+_selGtId,
		type: "GET",
		async: false,
		success:function(data){
			if(data.code==0 && !data.body){
				_selGroupServer=false;
				$(".header-search").find(".search-group").hide();
				$(".header-search").find(".search-server").hide();
			}
		}
	});
}



function initGroupServerSearch(){

	//主搜 请选择游戏区 过滤
	$(".group-search-div").on("input", ".tit-search .tit-keyword", function(){
		var matchObj = getPyKeyWord($(this).parent().find(".tit-keyword").val());
		var _txt = matchObj.hz_txt;
		if(matchObj.type=='py'){
			_txt = matchObj.py_txt;
		}
		$(".group-search-div").find(".pop-content li").each(function(idx, item){
			if(_txt==''){
				$(this).show();
			}else{
				var dataValue=$(item).attr("data-groupname");
				var _target = dataValue;
				if(matchObj.type=='py'){
					_target = getPyKeyWord(dataValue).py_txt;
				}
				if(_target.indexOf(_txt) > -1){
					$(this).show();
				}else{
					$(this).hide();
				}
			}
		});
	});

//主搜 请选择游戏服 过滤
	$(".server-search-div").on("input", ".tit-search .tit-keyword", function(){
		var matchObj = getPyKeyWord($(this).parent().find(".tit-keyword").val());
		var _txt = matchObj.hz_txt;
		if(matchObj.type=='py'){
			_txt = matchObj.py_txt;
		}
		$(".server-search-div").find(".pop-content li").each(function(idx, item){
			if(_txt==''){
				$(this).show();
			}else{
				var dataValue=$(item).attr("data-servername");
				var _target = dataValue;
				if(matchObj.type=='py'){
					_target = getPyKeyWord(dataValue).py_txt;
				}
				if(_target.indexOf(_txt) > -1){
					$(this).show();
				}else{
					$(this).hide();
				}
			}
		});
	});
}