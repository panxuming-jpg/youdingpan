var saveListAll = {};
var saveListPc = {};
var saveListM = {};
var saveList = {};
var goodsType = ''
$(function() {
	goodsType = getUrlParam('goodsType')?getUrlParam('goodsType'):'0';
	jQuery(".banner-box .slideBox").slide({
		mainCell: ".bd ul",
		effect: "leftLoop",
		autoPlay: true,
		delayTime: 300,
		interTime: 5000
	});
	jQuery(".account-record-box .list").slide({
		mainCell: ".bd ul",
		autoPlay: true,
		effect: "leftMarquee",
		vis: 3,
		interTime: 50
	});
	jQuery(".recommend-shop-list").slide({
		titCell: ".hd ul",
		mainCell: ".bd ul",
		autoPage: true,
		effect: "leftLoop",
		autoPlay: true,
		vis: 5,
		trigger: "click"
	});
	jQuery(".hot-games-list").slide({
		mainCell: ".bd .bd-wrap-ul",
		trigger: "click"
	});
	$(".quk-area .bottom-area .search-item input").focus(function(){
		$(".quk-area .bottom-area .search-item a").css("background","#444");
	});
	$(".quk-area .bottom-area .search-item input").blur(function(){
		$(".quk-area .bottom-area .search-item a").css("background","#666");
	});
	
	$(".act-list-head .act-search input").focus(function(){
		$(this).parent().addClass("focus");
	});
	$(".act-list-head .act-search input").blur(function(){
		$(this).parent().removeClass("focus");
	});
	$(".act-head .act-search input").focus(function(){
		$(this).parent().addClass("focus");
	});
	$(".act-head .act-search input").blur(function(){
		$(this).parent().removeClass("focus");
	});
	//删除关键字
	$(".gamekey").focus(function(){
		$(this).parent().find(".delekey").show();
	});
	$(".gamekey").blur(function(){
		if($(".gamekey").val().length==0){
			$(this).parent().find(".delekey").hide();
		}
	});
	$(".game-seach").find(".delekey").click(function(){
		event.stopPropagation();
		$(".gamekey").val('');
		query['key']= '';
		query['hotFlag']= '';
		loadGame(query);
	});
	//点击搜索
	$(".tosearch").click(function(){
		search_game();
	});

	var gameSearchDelayTimer;
	$('.game-seach .gamekey').on('input', function() {
		clearTimeout(gameSearchDelayTimer);
		// 设置延迟执行
		gameSearchDelayTimer = setTimeout(function() {
			setTimeout(search_game, 300);
		}, 300);
	});
});

function search_game(){
	var gameKey = $(".gamekey").val();
	query['hotFlag']= '';
	query['px']= '';
	query['key']= gameKey;
	query['gameType']= '';
	$(".gametype").find("li").eq(0).addClass("on").siblings().removeClass("on");
	loadGame(query,true);
}

//游戏搜索
function loadGame(query,isSearch){
	$.ajax({
		url: "https://gw.7881.com/basic/api/game-search",
		type: "post",
		data:JSON.stringify(query),
		dataType:'json',
		contentType:'application/json',
		success:function(data){
			if(data.body){
				var gameList = []
				var html = '';
				for(var i=0; i<data.body.length; i++){
					for(var j = i+1; j<data.body.length; j++){
						if(data.body[i].alias == data.body[j].alias){
							console.log(data.body[i].alias)
							if(data.body[i].mobileGameType=='0'){
								data.body[i].ardGameid = data.body[j].gameId
								data.body[i].iosGameid = data.body[i].gameId
							}else{
								data.body[i].iosGameid = data.body[j].gameId
								data.body[i].ardGameid = data.body[i].gameId
							}
							data.body.splice(j,1);
							j-=1;
						}
					}
					
				};
				
				for(var k=0; k<data.body.length; k++){
					if(data.body[k].alias){
						// 计算同步标识（兼容 flag 可能挂在 item 或 item.gameList[0] 上）
						var syncFlag = Number((data.body[k] && (data.body[k].pcMobileSyncFlag != null ? data.body[k].pcMobileSyncFlag : (data.body[k].gameList && data.body[k].gameList[0] && data.body[k].gameList[0].pcMobileSyncFlag)))) === 1;
						var syncIcon = syncFlag ? '<img class="gamelist-client-hand-icon" src="https://static.7881.com/7881/images/list-2024/client-hand-icon.png" />' : '';
						var gameJbIcon = '';
						if (data.body[k].gameType == 1 && !syncFlag) {
							gameJbIcon = '<span class="game-jb"><img src="https://static.7881.com/7881/images/wantbuy/phone-jb.png"/></span>';
						}
						
						// 端手同步：当 pcMobileSyncFlag==1 时，端游/手游两个 tab 都展示
						var showInTab = false;
						if (null == query['gameType'] || query['gameType'] === '') {
							showInTab = true;
						} else if (query['gameType'] == '0' || query['gameType'] == '1') {
							if (query['gameType'] == data.body[k].gameType) {
								showInTab = true;
							} else if (syncFlag) {
								showInTab = true;
							}
						}
						
						if (showInTab) {
							if(data.body[k].gameType==1){
								if(data.body[k].mobileGameType=='3' || data.body[k].mobileGameType=='4'){
									html +='<a href="https://search.7881.com/'+data.body[k].gameId+'-'+goodsType+'-0-0-0.html?pageNum=1" class="choseGame" data-gameid="'+data.body[k].gameId+'">'+
												'<dl>'+
													'<dt>'+
														'<img src="https://pic.7881.com/7881/market/images/game_logo/'+data.body[k].gameId+'.png"/>'+
														gameJbIcon;
														if (data.body[k].hot == 'hot') {
															html += '<span class="game-hot"><img src="https://static.7881.com/7881/images/publish-2024/gmhot-icon.png"/></span>';
														} else if (data.body[k].tag == 'NEW') {
															html += '<span class="game-new"><img src="https://static.7881.com/7881/images/publish-2024/gmnew-icon.png"/></span>';
														}
														html += syncIcon;
										html += '</dt>'+
													'<dd>'+
														'<p>'+data.body[k].alias+'</p>'+
													'</dd>'+
												'</dl>'+
											'</a>';
								}else{
									html +='<dl class="mgame">'+
													'<dt>'+
														'<img src="https://pic.7881.com/7881/market/images/game_logo/'+data.body[k].gameId+'.png"/>'+
														gameJbIcon;
														if (data.body[k].hot == 'hot') {
															html += '<span class="game-hot"><img src="https://static.7881.com/7881/images/publish-2024/gmhot-icon.png"/></span>';
														} else if (data.body[k].tag == 'NEW') {
															html += '<span class="game-new"><img src="https://static.7881.com/7881/images/publish-2024/gmnew-icon.png"/></span>';
														}
														html += syncIcon;
										html +='</dt>'+
													'<dd>'+
														'<p>'+data.body[k].alias+'</p>'+
														'<h3><a href="https://search.7881.com/'+data.body[k].iosGameid+'-'+goodsType+'-0-0-0.html?pageNum=1" class="ios">苹果版</a><a href="https://search.7881.com/'+data.body[k].ardGameid+'-'+goodsType+'-0-0-0.html?pageNum=1" class="android">安卓版</a></h3>'+
													'</dd>'+
												'</dl>';
								}
								
							}else{
								html +='<a href="https://search.7881.com/'+data.body[k].gameId+'-'+goodsType+'-0-0-0.html?pageNum=1" class="choseGame" data-gameid="'+data.body[k].gameId+'">'+
										'<dl>'+
											'<dt>'+
												'<img src="https://pic.7881.com/7881/market/images/game_logo/'+data.body[k].gameId+'.png?v=1.0" class="gmlogo"/>'+
												syncIcon+
											'</dt>'+
											'<dd>'+
												'<p>'+data.body[k].alias+'</p>'+
											'</dd>'+
										'</dl>'+
									'</a>'
							}
						}
					}
				};
				$(".nodata").hide();
				$(".gameList").show();
				$(".gameList").html(html);
				if(query['px']!=''){
					if(query['gameType']=='0'){
						saveListPc[query['px']]=html;
					}else if(query['gameType']=='1'){
						saveListM[query['px']]=html;
					}else{
						saveListAll[query['px']]=html;
					}
				}else if(query['hotFlag']=='hot'){
					if(query['gameType']=='0'){
						saveListPc['hot']=html;
					}else if(query['gameType']=='1'){
						saveListM['hot']=html;
					}else{
						saveListAll['hot']=html;
					}
				}
			}else{
				$(".nodata").show();
				$(".gameList").hide();
			}
			if(isSearch){
				var length = 0;
				if(data.body){
					length = data.body.length;
				}else{
					length = 0;
				}
				if(query['key'].length!=0){
					$(".ptfilter").find(".hotpx").hide();
					$(".ptfilter").find(".schresult").html('根据“<em>'+query['key']+'</em>”共搜到<em>'+length+'</em>款游戏，您是不是在找这些游戏？').show();
				}else{
					$(".ptfilter").find(".hotpx").show();
					$(".ptfilter").find(".schresult").hide();
				}
				
			}else{
				$(".ptfilter").find(".hotpx").show();
				$(".ptfilter").find(".schresult").hide();
			}
		}
	});
};


//温馨提示弹窗
function openTip(){
	var html1 = $(".sureSale").html();
	layer.open({
	  type: 1,
	  title:'',
	  skin: 'pop-tip',
	  area:['360px','225px'],
	  closeBtn:0,
	  content: html1,
	  success: function(){
		$(".pop-tip").find(".subtn").click(function(){
		  FcopenTip()
		});
	  }
	});
};
//选择游戏确认价格弹窗
function queryPrice(){
	var html1 = $(".queryInfo").html();
	layer.open({
	  type: 1,
	  title:'',
	  skin: 'pop-query',
	  area:['780px','627px'],
	  closeBtn:0,
	  content: html1,
	  success: function(){
		//字母点击切换
		$(".pop-query").find(".filer-query .pt-tit").on("click","li",function(){
			var datavalue = $(this).attr("data-value");
			$(this).addClass("on").siblings("li").removeClass("on");
			ptChange(datavalue);
		});
		//游戏点击切换
		$(".pop-query").find(".filer-query .pt-game").on("click"," li a",function(){
			var gameid = $(this).attr("data-gameid");
			$(this).parent().addClass("on").siblings("li").removeClass("on");
			$(".pop-query").find(".disab").removeClass("disab");
			$(".pop-query").find(".disabled").removeClass("disabled");
			$(".pop-query").find(".chosefiler .comselect input").val('').attr('data-value','');
			$(".pop-query").find(".chosefiler .comselect .comselect-menu").html("");
			$(".pop-query").find(".chosefiler p input").removeAttr("readonly").val('');
			gmChange(gameid);
		});
		$(".pop-query").on("keyup",".onlynums",function(){
			$(this).val($(this).val().replace(/[^\d.]/g,""));  
			$(this).val($(this).val().replace(/\.{2,}/g,".")); 
			$(this).val($(this).val().replace(".","$#$").replace(/\./g,"").replace("$#$","."));  
			$(this).val($(this).val().replace(/^(\-)*(\d+)\.(\d\d).*$/,'$1$2.$3'));
			if($(this).val().indexOf(".")< 0 && $(this).val() !=""){
			   $(this).val(parseFloat($(this).val()));
			};
		})
		//下一步
		$(".pop-query").find(".queryprice").Validform({
			btnSubmit:".next-step", 
			tiptype:3,
			datatype:{
				"comselect":function(gets,obj,curform,regxp){
					//参数gets是获取到的表单元素值，obj为当前表单元素，curform为当前验证的表单，regxp为内置的一些正则表达式的引用;
					if(obj.parents(".selectQf").css("display")!=="none"){
						console.log(111)
						var _dataval=obj.attr("data-value");
						if(!_dataval){
							obj.parents(".comselect").addClass("Validform_error");
							return false;
						}
					}else{
						return true;
					}
					
				},
				"howmuch":function(gets,obj,curform,regxp){
					var value = parseFloat(obj.val());
					if(value>9999999.99 || value < 0.01){
						layer.msg("商品价格为0.01-9999999.99之间的数字");
						return false;
					}
				},
				"gameAccount": function (gets, obj, curform, regxp) {
					var _account = obj.val().replace(/[\u4e00-\u9fa5]/g, '');
					if (_account != obj.val()) {
						layer.msg("游戏账号不能包含中文！");
						return false;
					}
				},
			},
			beforeCheck:function(curform){
			},
			beforeSubmit:function(curform){
				queryPriceBtn();
			}
		});
	  }
	});
};
//确认价格成功
function querySuccess(){
	var html1 = $(".querySuccess").html();
	layer.open({
	  type: 1,
	  title:'',
	  skin: 'pop-query',
	  area:['780px','580px'],
	  closeBtn:0,
	  content: html1,
	  success: function(){
		  FnquerySuccess();
	  }
	});
};
//确认价格失败
function queryFaild(){
	var html1 = $(".queryFaild").html();
	layer.open({
	  type: 1,
	  title:'',
	  skin: 'pop-query',
	  area:['360px','200px'],
	  closeBtn:0,
	  content: html1,
	  success: function(){
		  FnqueryFaild();
	  }
	});
};

function getUrlParam(name) {
	var reg = new RegExp("(^|&)" + name + "=([^&]*)(&|$)"); // 构造一个含有目标参数的正则表达式对象
	var r = window.location.search.substr(1).match(reg); // 匹配目标参数
	if (r != null) return unescape(r[2]);
	return null; // 返回参数值
}