;(function($){
	$.pc7881 = $.pc7881||{};
    $.pc7881={
        inits:function(){
					$(".main-account .hot-game-list .tab-item").subMenu();
					$(".top-common-right").Top();
					$(".dnfdl-percenter").nav03Pre();
					$(".index-tab").hoverTab(".index-tab-top",".index-tab-item");
					$(".placeholder").placeholder();
					$(".phoneNum").checkNumber();
					$(".onlynum").checkNumber();
					$(".kf-scrolltop").scroll_top(".kf-scrolltop");
					$(".backtop-box").scroll_top(".backtop-box");
					$(".top-adv-box").topAdv();
					$(".top-tips").topTips();
					$(".comselect").comSelect();
					// $(".onlynum").OnlyNum();
					$("body").find(".onlynum").OnlyNum();
					// $(".onlynums").OnlyNums();
					$("body").find(".onlynums").OnlyNums();
					$("body").find(".onlynumt").OnlyNumt();
					$("body").subInputPlus();
					$(".del-input").delInput();
        },
		subMenu: function () {
			$(document).mouseover(function () {
				$(".main-account .hot-game-list .tab-item").find("dl").removeClass("active");
			});
			$(this).find("dl").mouseover(function (event) {
				event.stopPropagation();
				$(this).addClass("active").siblings().removeClass("active");
			});

			$(".sub-menu").mouseover(function (event) {
				event.stopPropagation();
			});
		},
		Top:function(){
			$(this).find("a").hover(function(){
				$(this).find("i").removeClass("downJt").addClass("upJt");
			},function(){
				$(this).find("i").removeClass("upJt").addClass("downJt");
			});
		},
		nav03Pre:function(){
			$(this).mouseenter(function(){
				if(!$(this).hasClass("not-login")){
					$(this).find(".dnfdl-percenter-top").addClass("on").parent().find(".dnfdl-percenter-bot").show();
				}
			});
			$(this).mouseleave(function(){
				$(this).find(".dnfdl-percenter-top").removeClass("on").parent().find(".dnfdl-percenter-bot").hide();
			});
		},
		hoverTab:function(obj1,obj2){
			$(this).children(obj1).find("li").hover(function(){
                alert(1)

				$(this).addClass("on").siblings("li").removeClass("on");
				var flag= $(this).index();
				$(this).parent().parent().parent().find(obj2).eq(flag).show().siblings(obj2).hide();
			});
		},
		clickTab:function(obj1,obj2){
			$(this).children(obj1).find("li").click(function(){
				$(this).addClass("on").siblings("li").removeClass("on");
				var flag= $(this).index();
				$(this).parent().parent().parent().find(obj2).eq(flag).show().siblings(obj2).hide();
			});
		},
		placeholder:function(){
			$(".placeholder").find("input").val("");
			$(this).find("input").bind('propertychange input', function() { 
				if($(this).val() == ""){
					$(this).parent("label").find("span").show();
				}else{
					$(this).parent("label").find("span").hide();
				}
			});
			// 兼容IE9
			if(navigator.appName == "Microsoft Internet Explorer" && navigator.appVersion.match(/9./i)=="9."){
				$(".placeholder").each(function(index){
					var myInput = document.getElementsByClassName("placeholder")[index].childNodes[0], 
				    	lastValue = myInput.value;
					var onInput = function() {
					    if(lastValue !== myInput.value){
					    	lastValue = myInput.value;
					    	if(lastValue == ""){
					    		$(".placeholder").eq(index).find("span").show();
							}else{
								$(".placeholder").eq(index).find("span").hide();
							}
					    }
				  	};
				  	var onFocusChange = function(event) {
					    if(event.type === "focus") {
					    	document.addEventListener("selectionchange", onInput, false);
					    }else{
					    	document.removeEventListener("selectionchange", onInput, false);
					    }
				  	};
				  	myInput.addEventListener("input", onInput,false);
				  	myInput.addEventListener("focus", onFocusChange,false);
				  	myInput.addEventListener("blur", onFocusChange,false);
				});
			};
		},
		checkNumber:function(){
			$(this).bind("keypress",
		    function(c) {
		    	if(navigator.userAgent.indexOf("Firefox")<=0){//火狐存在兼容问题，将其排除
		    		var a = c || window.event;
		    		var b = typeof a.charCode == "number" ? a.charCode: a.keyCode;
		    		b == 0 ? b = b: b = String.fromCharCode(b);
		    		if (! ((/\d/.test(b)) && !(b > 9) && !a.ctrlKey)) {
		    			a.preventDefault ? a.preventDefault() : (a.returnValue = false)
		    		}
		    	}
		    }).bind("keyup",
		    function(d) {
		        var e = $(this),
		        b = e.val(),
		        c = [],
		        a = d.keyCode;
		        if (! (/^\d*$/).test(b)) {
		            e.val(e.val().replace(/[^0-9]/ig, ""));
		            return
		        }
		    });
		},
		scroll_top:function(obj){
            if (document.all && !document.querySelector) {
				$(obj).fadeIn();
			}else{
				$(window).bind("scroll", function(event){
	                if( $(window).scrollTop() >= 400 ) {
	                    $(obj).fadeIn();
	                }else{
	                    $(obj).fadeOut();
	                };
	            });
			}
            $("body").on("click",obj,function(){
            	$("html,body").animate({scrollTop: 0},200);
            });
        },
        topAdv:function(){
        	$(this).find(".close").click(function(){
        		$(".top-adv").slideUp("200");
        		$(".top-adv-box").find(".close").hide().css("top","-26px");
        		$(".top-adv-box").find(".open").css("display","block").animate({top:"-26px"},400);
        	});
        	
        	$(this).find(".open").click(function(){
        		$(".top-adv").slideDown("200");
        		$(".top-adv-box").find(".open").hide().css("top","10px");
        		$(".top-adv-box").find(".close").css("display","block").animate({top:"10px"},400);
        	});
        },
        topTips:function(){
        	$(this).find("span").click(function(){
        		$(this).parent().hide();
        	});
        },
        popLogin:function(){
        	var _html = $(".login-pop").html();
			$(".login-pop").children().remove();
        	layer.open({
		        type: 1,
		        title: false,
		        area: ['380px', '460px'],
		        content: _html,
		        cancel: function(){ $(".login-pop").append(_html); },
		        success: function(){
					login_2016();
				}
		    });
        },
        delInput:function(){
        	$(this).each(function(){
	        	var input = $(this).find(".common-input");
	        	var delBtn = $(this).find(".delinput-btn");
	            var fn = function(){
	                if(input.val().length>0){
	                	$(this).parents(".del-input").find(".delinput-btn").show();
	                }else{
	                	$(this).parents(".del-input").find(".delinput-btn").hide();
	                }
	            };
	            input.bind('input.autocomplete',fn).bind('propertychange.autocomplete',function(e){
	                if(e.originalEvent.propertyName && e.originalEvent.propertyName == 'value'){
	                    fn.call(this,e);
	                }
	            });
	            //ie9支持addEventListener，ie10开始支持FileReader api
	            if(document.all && typeof FileReader === 'undefined' && window.addEventListener){
	                //退格与删除
	                input.bind("keyup.autocomplete", function(e) {
	                    var key = e.keyCode;
	                    (key == 8 || key == 46) && $(this).trigger('input.autocomplete');
	                });
	                //剪切
	                input.bind("cut.autocomplete", function(e){
	                    $(this).trigger('input.autocomplete')
	                });
	            };
	            input.focus(function(){
	            	if($(this).val().length>0){
	            		$(this).parents(".del-input").find(".delinput-btn").show();
	            	}else{
	            		$(this).parents(".del-input").find(".delinput-btn").hide();
	            	}
	            });
	            input.blur(function(){
	            	if($(this).val().length == 0){
	            		$(this).parents(".del-input").find(".delinput-btn").hide();
	            	}
	            	
	            });
	            delBtn.click(function(){
	            	input.val("");
	            	input.focus();
	            });
            });
            
        },
        comSelect:function(){
        	$(document).click(function(){
        		$(".comselect").removeClass("act");
        		$(".comselect-menu").hide();
						$(".comselect-menu").find(".check-con").hide();
        		$(".comselect-icon").removeClass("up");
        		$(".common-form").find(".form-item").css("z-index","1");
				$(".common-form").find(".form-item-r").css("z-index","1");
        	});
        	$(document).on("click",".comselect",function(event){
        		event.stopPropagation();
        	});
        	
        	$("body").on("click",".comselect-icon",function(){
        		if($(this).hasClass("up")){
        			$(document).trigger("click");
        			return false;
        		}
        	});
        	$("body").on("click",".comselect-val",function(){
        		$(".common-form").find(".form-item").css("z-index","1");
				$(".common-form").find(".form-item-r").css("z-index","1");
        		$(this).parents(".form-item").css("z-index","99");
				$(this).parents(".form-item-r").css("z-index","99");
        		if(!$(this).parent(".comselect").hasClass("disabled")){
	        		$(".comselect").removeClass("act");
	        		$(".comselect-menu").hide();
	        		$(".comselect-icon").removeClass("up");
	        		$(this).parent().removeClass("Validform_error");
	        		$(this).parent().addClass("act");
	        		$(this).find(".comselect-menu").hide();
	        		$(this).find(".comselect-icon").removeClass("up");
	        		if($(this).parent().find(".comselect-menu").find("li").length>0 || $(this).parent().find(".comselect-menu").find(".select-item").length>0){
	        			$(this).parent().find(".comselect-menu").show();
	        			$(this).parent().find(".comselect-icon").addClass("up");
	        		}
        		}
        	});
	        $("body").on("click",".comselect-menu li",function(){
	        	
	        	if(!$(this).hasClass("disab")){
		        	$(this).parents(".form-item").css("z-index","1");
					$(this).parents(".form-item-r").css("z-index","1");
					$(this).parent().parent().find(".comselect-icon").removeClass("up");
					$(this).parents(".comselect").removeClass("Validform_error");
					if($(this).parents(".comselect").hasClass("select-game")){
						var _text = $(this).text().substr(2,$(this).text().length);
					}else{
						var _text = $(this).text();
					}
					var _val = $(this).data("value");
					$(this).parent().parent().find(".comselect-val").children(".comselect-input").val(_text).attr("data-value",_val);
					$(this).parent().parent().find(".comselect-val").children(".comselect-input").next("input").val(_val).attr("data-value",_text);
					if($(this).parent().parent().hasClass("linkage") == true){
						var flag = $(this).parent().parent(".linkage");
						var _index = $(".linkage").index(flag);
						try{
							ComLinkage(_index);
							$(".linkage").eq(_index+1).find(".comselect-input").val("").attr("data-value","");
							$(".linkage").eq(_index+1).find(".comselect-input").next("input").val("").attr("data-value","");
						}catch(e){
							
						}
					};
					
					if($(this).parent().parent().hasClass("callback")){
						var _index = $(".callback").index($(this).parent().parent(".callback"));
						try{
							Callback(_index);
						}catch(e){}
					}
					$(this).parent(".comselect-menu").hide();
					$(this).parents(".comselect").removeClass("act");
				}
	        	
			});
		},
		OnlyNum:function(){ //只能输入数字
			$(this).keyup(function(){      
					$(this).val($(this).val().replace(/\D|/g,''));
					if($(this).val().indexOf(".")< 0 && $(this).val() !=""){//以上已经过滤，此处控制的是如果没有小数点，首位不能为类似于 01、02的金额  
				 $(this).val(parseFloat($(this).val()));
				};
		    }).bind("paste",function(){  //CTR+V事件处理      
		        $(this).val($(this).val().replace(/\D|^0/g,''));
		    }).css("ime-mode", "disabled");
		},
		OnlyNums:function(){ //只能输入数字和小数点后两位
			$(this).keyup(function(){
				$(this).val($(this).val().replace(/[^\d.]/g,""));  //清除“数字”和“.”以外的字符   
				$(this).val($(this).val().replace(/\.{2,}/g,".")); //只保留第一个. 清除多余的   
				$(this).val($(this).val().replace(".","$#$").replace(/\./g,"").replace("$#$","."));  
				$(this).val($(this).val().replace(/^(\-)*(\d+)\.(\d\d).*$/,'$1$2.$3'));//只能输入两个小数   
				if($(this).val().indexOf(".")< 0 && $(this).val() !=""){//以上已经过滤，此处控制的是如果没有小数点，首位不能为类似于 01、02的金额  
				   $(this).val(parseFloat($(this).val()));
				};
            }).bind("paste",function(){  //CTR+V事件处理      
            	$(this).val($(this).val().replace(/[^\d.]/g,""));  //清除“数字”和“.”以外的字符   
				$(this).val($(this).val().replace(/\.{2,}/g,".")); //只保留第一个. 清除多余的   
				$(this).val($(this).val().replace(".","$#$").replace(/\./g,"").replace("$#$","."));  
				$(this).val($(this).val().replace(/^(\-)*(\d+)\.(\d\d).*$/,'$1$2.$3'));//只能输入两个小数   
				if($(this).val().indexOf(".")< 0 && $(this).val() !=""){//以上已经过滤，此处控制的是如果没有小数点，首位不能为类似于 01、02的金额  
				   $(this).val(parseFloat($(this).val()));
				};
            }).css("ime-mode", "disabled");
		},
		OnlyNumt:function(){ //只能输入数字和小数点后两位
			$(this).keyup(function(){
				$(this).val($(this).val().replace(/[^\d.]/g,""));  //清除“数字”和“.”以外的字符   
				$(this).val($(this).val().replace(/\.{2,}/g,".")); //只保留第一个. 清除多余的   
				$(this).val($(this).val().replace(".","$#$").replace(/\./g,"").replace("$#$","."));  
				$(this).val($(this).val().replace(/^(\-)*(\d+)\.(\d\d\d).*$/,'$1$2.$3'));//只能输入两个小数   
				if($(this).val().indexOf(".")< 0 && $(this).val() !=""){//以上已经过滤，此处控制的是如果没有小数点，首位不能为类似于 01、02的金额  
				   $(this).val(parseFloat($(this).val()));
				};
		        }).bind("paste",function(){  //CTR+V事件处理      
		        	$(this).val($(this).val().replace(/[^\d.]/g,""));  //清除“数字”和“.”以外的字符   
				$(this).val($(this).val().replace(/\.{2,}/g,".")); //只保留第一个. 清除多余的   
				$(this).val($(this).val().replace(".","$#$").replace(/\./g,"").replace("$#$","."));  
				$(this).val($(this).val().replace(/^(\-)*(\d+)\.(\d\d\d).*$/,'$1$2.$3'));//只能输入两个小数   
				if($(this).val().indexOf(".")< 0 && $(this).val() !=""){//以上已经过滤，此处控制的是如果没有小数点，首位不能为类似于 01、02的金额  
				   $(this).val(parseFloat($(this).val()));
				};
		        }).css("ime-mode", "disabled");
		},
		subInputPlus:function(){
        	$(this).on("click",".sub-input-plus .btn-num",function(){
				var _this=$(this);
				var _min = parseInt(_this.parent().find("input").attr("data-min"));
				var _max = parseInt(_this.parent().find("input").attr("data-max"));
				var v=parseInt(_this.parent().find("input").val());
				if(_this.hasClass("btn-l")&&v>_min){
					v--;
					_this.parent().find("input").val(v);
					_this.parent().find("span").removeClass("unusable");
					if(v==_min){
						_this.addClass("unusable");
					}
					try{
						inputLinkage();
					}catch(e){
					}
					
				}
				if(_this.hasClass("btn-r")&&v<_max){
					v++;
					_this.parent().find("input").val(v);
					_this.parent().find("span").removeClass("unusable");
					if(v==_max){
						_this.addClass("unusable");
					}
					try{
						inputLinkage();
					}catch(e){
					}
				}
				if(_min==_max){
					
					_this.parent().find("input").attr("readonly","readonly");
				}else{
					_this.parent().find("input").removeAttr("readonly");
				}
			});
      	}
        
    }
    $.extend($.fn,$.pc7881);
    $(function(){$.pc7881.inits();})
})(jQuery);

function login_2016(){
	// 模拟placeholder && 获取焦点发光
	$(".placeholder").click(function(event) {
		$(this).siblings('.comIpt').focus();
		if($(this).siblings('.pureIpt').length > 0) {
			$(this).siblings('.pureIpt').focus();
		}
		$(this).addClass("hide");
	});
	$(".loginBox").find("input").not(":checkbox, :button, :radio").focus(function() {
		if($(this).siblings('.placeholder').length > 0) {
			$(this).siblings('.placeholder').addClass("hide");
		}
		if ($(this).hasClass('loginUserIpt') && $.trim($(this).val())) {
			$(this).next('.delIcon').removeClass('hide');
		};
		$(this).parent().addClass('focusShadow');
	});
	$(".loginBox").find("input").not(":checkbox, :button, :radio").blur(function() {
		if (!$.trim($(this).val())) {
			$(this).siblings('.placeholder').removeClass("hide");
			if ($(this).siblings('.delIcon').length > 0) {
				$(this).siblings('.delIcon').addClass('hide');
			};
		};
		$(this).parent().removeClass("focusShadow");
	});
	$(".loginUserIpt").keydown(function() {
		$(this).next('.delIcon').removeClass('hide');
	});
	$(".loginUserIpt").blur(function() {
		var $_self = $(this);
		setTimeout(function() {
			$_self.next('.delIcon').addClass('hide');
		}, 200);
		
	});
	//用户名框删除
	$(".delIcon").click(function() {
		$(this).siblings(".loginUserIpt").focus().val("");
		$(this).addClass('hide');
	});
	//验证码交互
	$(".pureIpt").focus(function() {
		$(this).next(".codePlaceholder").addClass('hide');
	});
	$(".pureIpt").blur(function(event) {
		if(!$(this).val()) {
			$(this).siblings('.placeholder').removeClass('hide');
		}
	});
	// 查看密码图标变换
	$(".loginEye").hover(function() {
		$(this).find('i').addClass('loginEyeIconHover');
	}, function() {
		$(this).find('i').removeClass('loginEyeIconHover');
	});
	$(".loginEye").click(function() {
		if ($('.passContainer input:text').val() == "请输入密码") {
			return false;
		}else if ($(this).find('i').hasClass('loginEyeIconActive')){
			$('.passContainer input:text').parent().addClass('hide');
			$('.passContainer input:password').parent().removeClass('hide');
			$(this).find('i').removeClass('loginEyeIconActive');
			$(this).parent().siblings().find('.loginEyeIcon').removeClass('loginEyeIconActive');
			
		}else {
			$(this).find('i').addClass('loginEyeIconActive');
			$(this).parent().siblings().find('.loginEyeIcon').addClass('loginEyeIconActive');
			$('.passContainer input:text').removeClass('color9')
										 .parent().removeClass('hide');
			$('.passContainer input:password').parent().addClass('hide');
		}
	});
	$('.passContainer input:text').focus(function() {
		if ($(this).parent().find('.loginEyeIcon').hasClass('loginEyeIconActive')) {
			if ($(this).val() == '请输入密码') {
				$(this).val('').removeClass('color9');
			};
			
		} else if ($(this).val() == '请输入密码') {
			$(this).parent().addClass('hide');
			$(this).parent().siblings().removeClass('hide');
			$(this).parent().siblings().find('input').focus();
		};
	});
	$('.passContainer input').keyup(function() {
		var t = $(this).val();
		$(this).parent().siblings().find('input').val(t);
	});
	$('.passContainer input:text').blur(function() {
		if ($(this).parent().find('.loginEyeIcon').hasClass('loginEyeIconActive') && $.trim($(this).val()) =="") {
	          $(this).val("请输入密码").addClass('color9');
	
		};
	});
	$('.passContainer input:password').blur(function() {
		if (!$.trim($(this).val())) {
			$(this).parent().addClass('hide');
			$(this).parent().siblings().removeClass('hide');
			$(this).parent().siblings().find('input').val('请输入密码').addClass('color9');
		};
	});
	// 点击切换验证码
	$(".codeImg").click(function(event) {
		this.src = 'http://www.7881.com/img_valid.jsp?param=' + new Date().getTime();
	});
	$(".changeOne").click(function(event) {
		$(".codeImg").trigger('click');
		return false;
	});
	$(function() {
		$(".loginBox").find("input").not(":checkbox, :button, :radio, .dropIpt, .passContainer input").val("");
		$('.passContainer input:eq(0)').val('请输入密码');
		$('.passContainer input:eq(1)').val('');
	});
	// 点击登录按钮
	$(".loginBtn").click(function(event) {
		checkLogin();
		return false;
	});
	
	//预览大图 空白关闭
	$("body").on("click",".viewer-canvas",function(){
		$(this).parent().find(".viewer-close").trigger("click");
	});
	$("body").on("click",".viewer-canvas img",function(e){
		e.stopPropagation();
	});
	
	function checkLogin() {
		if (!$.trim($('.loginUserIpt').val())) {
			$('.loginUserIpt').parent().addClass("focusError");
			$(".loginError").removeClass("hide");
			$(".loginErrorText").html($('.loginUserIpt').attr("data-error"));
		} else if ($('.loginPwdIpt:eq(0)').val() == '' || $('.loginPwdIpt').val() == '请输入密码') {
			$('.loginPwdIpt').parent().addClass("focusError");
			$(".loginError").removeClass("hide");
			$(".loginErrorText").html($('.loginPwdIpt').attr("data-error"));
		} else if (!$.trim($('.pureIpt').val())) {
			$('.pureIpt').parent().addClass("focusError");
			$(".loginError").removeClass("hide");
			$(".loginErrorText").html($('.pureIpt').attr("data-error"));
		} else {
			$(".loginBtn").text('正在登录...');
			$(".loginBtn").attr("disabled","disabled");
			$(".loginError").addClass("hide");
		};
	}
	$(".loginBox input").keydown(function() {
		$(this).parent().removeClass('focusError');
		$(".loginError").addClass("hide");
	});
};

//查看大图
function popBigPic(url){
	layer.photos({
		photos: {
			"title":"示例图",
			"start": 0,
			"data": [
				{
					"alt": "",
					"pid": 1,
					"src": url
				}
			]
		},
		footer: false
	});
};

//验证手机号
function checkphone(obj){
	var valnum = $(obj).val().length;
	var tel = $(obj).val().replace(/\s+/g,"");//获取手机号并清空空格
	var telReg = !!tel.match(/^1[0-9]{10}$/);
	if(telReg == false){ //如果手机号码不能通过验证
		return true;
	}else{ //如果手机号码通过验证
		return false;
	}
};

/**
 * 通用一句话弹出层
 * tit：弹出层标题
 * txt：弹出层文本
 * qxflag：true有取消按钮,false没有取消按钮
 * fun1：确认回调函数
 * fun2：取消回调函数
**/
function Alert(tit,txt,qxflag,fun1,fun2,btn1txt,btn2txt){
	var _btn_box1;
	var _btn_box2;
	if(typeof(btn1txt)=="undefined"){
		_btn_box1 ='<p class="popup-btn"><a href="javascript:void(0)" class="com-btn-03 color01 confirm-btn">确 认</a></p>';
	}else{
		_btn_box1 ='<p class="popup-btn"><a href="javascript:void(0)" class="com-btn-03 color01 confirm-btn">'+btn1txt+'</a></p>';
	};
	if(typeof(btn2txt)=="undefined"){
		var _btn_box2 = '<p class="popup-btn"><a href="javascript:void(0)" class="com-btn-03 color01 confirm-btn">确 认</a><a href="javascript:void(0)" class="com-btn-03 color03 cancel-btn">取 消</a></p>';
	}else{
		var _btn_box2 = '<p class="popup-btn"><a href="javascript:void(0)" class="com-btn-03 color01 confirm-btn">'+btn1txt+'</a><a href="javascript:void(0)" class="com-btn-03 color03 cancel-btn">'+btn2txt+'</a></p>';
	};
	if(qxflag){
		btn_box = _btn_box2
	}else{
		btn_box =_btn_box1
	};
	layer.open({
		type: 1,
		skin: 'com-popup',
		area: '400px',
		move:false,
		title:tit,
		shadeClose: true,
		content: '<div class="compop-box">'+
						'<h2>'+txt+'</h2>'+
						btn_box+
					'</div>',
		success:function(){
			$(".confirm-btn").click(function(){
				try{
					fun1();
				}catch(e){
					
				}
				layer.closeAll();
			});
			$(".cancel-btn").click(function(){
				try{
					fun2();
				}catch(e){
					
				}
				layer.closeAll()
			});
		}
	});
};

//计算(解决浮点数问题!)

//加法
function add(a, b) {
    var c, d, e;
    try {
        c = a.toString().split(".")[1].length;
    } catch (f) {
        c = 0;
    }
    try {
        d = b.toString().split(".")[1].length;
    } catch (f) {
        d = 0;
    }
    return e = Math.pow(10, Math.max(c, d)), (mul(a, e) + mul(b, e)) / e;
}

//减法
function sub(a, b) {
    var c, d, e;
    try {
        c = a.toString().split(".")[1].length;
    } catch (f) {
        c = 0;
    }
    try {
        d = b.toString().split(".")[1].length;
    } catch (f) {
        d = 0;
    }
    return e = Math.pow(10, Math.max(c, d)), (mul(a, e) - mul(b, e)) / e;
}

//乘法
function mul(a, b) {
    var c = 0,
        d = a.toString(),
        e = b.toString();
    try {
        c += d.split(".")[1].length;
    } catch (f) {}
    try {
        c += e.split(".")[1].length;
    } catch (f) {}
    return Number(d.replace(".", "")) * Number(e.replace(".", "")) / Math.pow(10, c);
}

//除法
function div(a, b) {
    var c, d, e = 0,
        f = 0;
    try {
        e = a.toString().split(".")[1].length;
    } catch (g) {}
    try {
        f = b.toString().split(".")[1].length;
    } catch (g) {}
    return c = Number(a.toString().replace(".", "")), d = Number(b.toString().replace(".", "")), mul(c / d, Math.pow(10, f - e));
}

//强制保留小数点后N位(不进行四舍五入!!!直接截取!!!)
function cutXiaoNum(num, len) {
   	var numStr = num.toString();
   	if(len == null || len == undefined){
       len = numStr.length;
   	}
   	var index = numStr.indexOf('.');
   	if(index == -1){
       index = numStr.length;
       numStr += ".0000000000000";
   	}else{
       numStr += "0000000000000";
   	}
   	var newNum = numStr.substring(0, index + len + 1);
   	if(len==0){
   		newNum = parseInt(newNum)
   	}
   	return newNum;
}

//强制进位加1
function incrXiaoNum(num, len) {
   	var numStr = num.toString();
		var newNum = num;
   	var index = numStr.indexOf('.');
   	if(index != -1){
			if(parseFloat(numStr.substring(index+1,numStr.length))>0){
				newNum = parseInt(num)+1
			}
   	}
   	return newNum;
}

//获取浏览器名称
function GetCurrentBrowser () {
    let ua = navigator.userAgent.toLocaleLowerCase()
    let browserType = null
    if (ua.match(/msie/) != null || ua.match(/trident/) != null) {
        browserType = 'IE'
    } else if (ua.match(/firefox/) != null) {
        browserType = 'firefox'
    } else if (ua.match(/ucbrowser/) != null) {
        browserType = 'UC'
    } else if (ua.match(/opera/) != null || ua.match(/opr/) != null) {
        browserType = 'opera'
    } else if (ua.match(/bidubrowser/) != null) {
        browserType = 'baidu'
    } else if (ua.match(/metasr/) != null) {
        browserType = 'Sougou'
    } else if (ua.match(/tencenttraveler/) != null || ua.match(/qqbrowse/) != null) {
        browserType = 'QQ'
    } else if (ua.match(/maxthon/) != null) {
        browserType = 'Maxthon'
    } else if (ua.match(/chrome/) != null) {
        var is360 = _mime('type', 'application/vnd.chromium.remoting-viewer')
        if (is360) {
            browserType = '360浏览器'
        } else {
            browserType = 'Chrome'
        }
    } else if (ua.match(/safari/) != null) {
        browserType = 'Safari'
    } else {
        browserType = 'Others'
    }
    return browserType
}

function _mime (option, value) {
    var mimeTypes = navigator.mimeTypes
    for (var mt in mimeTypes) {
        if (mimeTypes[mt][option] === value) {
            return true
        }
    }
    return false
}

//转数字字符串为逗号分隔字符串
function formatSplitNumber(number) {
	var parts = number.toString().split(".");
	parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
	return parts.join(".");
}