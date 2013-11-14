/*
******************************************************
* File:AutoGainControl.js
* Date:6/10/2013
* Version: 1.0
* Author: Alban Vidal-Naquet (alban@albanvn.net)
* Sarah plugin for Automatic Gain Control
******************************************************
*/

////////////////////////////////////////////////
/* TODO LIST
*/

// Constant
const gs_timer=60*5;
const gs_maxhisto=4;

// Variables
var loc=require("../customloc.js").init(__dirname);

var g_index=-1;
var g_handle=-1;
var g_histo=new Array();
var g_mic="---";
var g_vol="---";
var g_mainvol="---";
var g_lastdb="---";
var g_nircmdc="";
var g_oldvalue=0;
var g_auto=1;
var g_debug=0;

exports.init = function(SARAH)
{
  var config=SARAH.ConfigManager.getConfig();
  config = config.modules.AutoGainControl;
  if (process.env['PROCESSOR_ARCHITECTURE']=="x86")
    g_nircmdc=__dirname+"\\"+"bin\\nircmdc.exe";
  else
    g_nircmdc=__dirname+"\\"+"bin\\nircmdc64.exe";
  if (setTimer(config,SARAH,"")==-1)
    redoCheck(config, SARAH, 10, "AutoGainControl: error while connecting to netatmo data, please configure plugin");
  // Call setMainVolume each minutes
  setInterval(function(){setMainVolume(config, SARAH);}, 1000*60);
  return;
}

exports.release = function(SARAH)
{
	clearInterval();
	delete g_histo;
}

exports.action = function(data, callback, config, SARAH)
{
    if (typeof data.mode!='undefined')
	  switch(data.mode)
	  {
	    case "status":
			loc.addDictEntry("VOL", g_vol, 0);
			loc.addDictEntry("MIC", g_mic, 0);
			SARAH.speak(loc.getLocalString("STATUS"));
			if (typeof config.app_name!='undefined' && config.app_name!="")
				if (typeof data.silent==="undefined" || data.silent==0)
				{
					loc.addDictEntry("MAINVOL", g_mainvol, 0);
					SARAH.speak(loc.getLocalString("STATUS2"));
				}
			break;
		case "go":
			if (g_handle!=-1)
			{
				if (typeof data.silent==="undefined" || data.silent==0)
					SARAH.speak(loc.getLocalString("OKLETSGO"));
				analyseData(1, config, SARAH.context.Netatmo2Info, SARAH);
			}
			else
				SARAH.speak(loc.getLocalString("IDNONETATMOFIND"));
			break;
		case "setmainvol":
			var cmd_param;
			g_mainvol=data.value;
			if (typeof data.silent==="undefined" || data.silent==0)
			{
				loc.addDictEntry("VALUE", data.value, 0);
				SARAH.speak(loc.getLocalString("SETMAINVOLUME"));
			}
			cmd_param="setsysvolume"+" "+(data.value*65536/100);
			runSoundControl(cmd_param, SARAH);
			break;
		case "setvol":
			var cmd_param;
			if (typeof data.silent==="undefined" || data.silent==0)
			{
				loc.addDictEntry("VALUE", data.value,0);
				SARAH.speak(loc.getLocalString("SETVOLUME"));
			}
			if (typeof config.app_name!='undefined' && config.app_name!="")
			{
				// Syntax for setappvolume: setappvolume app_name|app_pid|app_path 
				// For example: setappvolume WSRMacro_Kinect.exe 0-1
				cmd_param="setappvolume"+" "+config.app_name+" "+(data.value/100);
			}
			else
				cmd_param="setsysvolume"+" "+(data.value*65536/100);
			g_vol=data.value;
			runSoundControl(cmd_param, SARAH);
			break;
		case "setmic":
			var cmd_param;
			if (typeof data.silent==="undefined" || data.silent==0)
			{
				loc.addDictEntry("VALUE", data.value,0);
				SARAH.speak(loc.getLocalString("SETMIC"));
			}
			if (typeof config.mic_device!='undefined' && config.mic_device!="" &&
			    typeof config.mic_card!='undefined' && config.mic_card!="")
			{
				// Syntax for setsysvolume: setsysvolume 0-65536 device_name mic_card
				// For example: setsysvolume 65536 "réseau de microphones" 2
				cmd_param="setsysvolume"+" "+Math.round(data.value*65536/100)+" \""+config.mic_device+"\" "+config.mic_card;
				g_mic=data.value;
				runSoundControl(cmd_param, SARAH);
			}
			break;
		case "disableauto":
			if (typeof data.silent==="undefined" || data.silent==0)
				SARAH.speak(loc.getLocalString("DISABLEAUTO"));
			g_auto=0;
			break;
		case "enableauto":
			if (typeof data.silent==="undefined" || data.silent==0)
				SARAH.speak(loc.getLocalString("ENABLEAUTO"));
			g_auto=1;
			break;
	  }
	// If Timer is not armed, then try to arm it, but don't log any information
	if (g_handle==-1)
		setTimer(config, SARAH, "");
	callback();
	return;
}

var setTimer=function(config, SARAH, msg)
{
  if (typeof config.netatmo_id!='undefined' && config.netatmo_id!="" && typeof SARAH.context.Netatmo2Info!='undefined')
  {
    g_handle=setInterval(function(){analyseData(0, config, SARAH.context.Netatmo2Info, SARAH);}, 1000*gs_timer);;
	// To catch the first item after launch...
    setTimeout(function(){analyseData(0, config, SARAH.context.Netatmo2Info, SARAH);}, 1000);
	return 0;
  }
  else
    if (msg!="") 
		console.log(msg);
  return -1;
}

function redoCheck(config, SARAH, timer, msg)
{
  // Try connection with NETATMO in 10 seconds...
  setTimeout(function(){setTimer(config,SARAH,msg);}, timer*1000);
}

function clearInterval()
{
	if (g_handle!=-1)
		clearInterval(g_handle);
}

var deformatString=function(string)
{
  var pos1=string.indexOf("%");
  var pos2=string.indexOf("=");
  var i={result:false,value:0,hour_b:0,min_b:0,hour_e:23,min_e:59};
  if (string.length<13)
    return i;
  if (pos1!=-1)
    i.value=parseInt(string.substring(0,pos1));
  if (pos2!=-1)
  {
	pos1=string.lastIndexOf("-");
	i.hour_b=parseInt(string.substr(pos2+1,2));
	i.min_b=parseInt(string.substr(pos2+3,2));
	i.hour_e=parseInt(string.substr(pos1+1,2));
	i.min_e=parseInt(string.substr(pos1+3,2));
  }
  return i;
}

var checkDateRange=function(string, date)
{
  var i;  
  
  if (string=="" || typeof string==='undefined')
    return {result:false};
  i=deformatString(string);
  if (date.getHours()<i.hour_b || date.getHours()>i.hour_e)
    return i;  
  if (date.getHours()==i.hour_b)
  {
    if (date.getMinutes()<i.min_b)
		return i;
  }
  if (date.getHours()==i.hour_e)
	if (date.getMinutes()>i.min_e)
		return i;
  i.result=true;
  return i;
}

var getStatus=function(config, SARAH)
{
  var info={};
  info.mainvol=g_mainvol;
  info.vol=g_vol;
  info.mic=g_mic;
  info.last=g_lastdb;
  info.auto=g_auto;
  return info;
}

exports.getStatus=getStatus;

function analyseData(ondemand, config, NetatmoInfo, SARAH)
{
  var sum=0;
  // If cron mode then integrate new NETATMO value
  if (ondemand==0)
  {
	  if (g_index==-1)
		for (i=0;i<NetatmoInfo.names.length;i++)
		  if (NetatmoInfo.names[i]==config.netatmo_id && NetatmoInfo.types[i]=="NAMain")
		  {
			g_index=i;
			break;
		  }
	  if (g_index==-1)
	  {
		console.log("AutoGainControl: Can not find device '"+config.netatmo_id+"' with type 'NAMain'");
		return;
	  }
	  // Get new value
	  if ((g_debug&1)!=0)
		console.log("value:"+NetatmoInfo.values[g_index][4]);
	  if (typeof NetatmoInfo.values[g_index][4]==='undefined')
		return;
	  g_lastdb=NetatmoInfo.values[g_index][4];
	  // Save value in history
	  g_histo.push(parseInt(NetatmoInfo.values[g_index][4]));
	  // If histo is too big
	  if (g_histo.length>gs_maxhisto)
		// Then shift out the first item
		g_histo.shift();
  }
  
  // If automatic gain control is disabled then skip the next part...
  if (g_auto==0)
	return;
	
  // Do average on last entries
  for(i=0;i<g_histo.length;i++)
	sum+=g_histo[i];
  if (g_histo.length>0)
	sum/=g_histo.length;
  // If noise is null then you live in an abstract world !
  if (sum==0)
	return; 
  if ((g_debug&1)!=0)
	console.log("sum is:"+sum+" nb:"+g_histo.length);

	// Now process the new sound setting
  var min_db=parseInt(config.min_db);
  var max_db=parseInt(config.max_db);
  var min_vol=parseInt(config.min_vol);
  var max_vol=parseInt(config.max_vol);
  var min_gainmic=parseInt(config.min_gain_mic);
  var max_gainmic=parseInt(config.max_gain_mic);
  var cmd_param="";
  var mic=-1;
  var vol=-1;
  if (sum<min_db)
  {
	if (min_gainmic!=0 && max_gainmic!=0)
		mic=max_gainmic;
	if (min_vol!=0 && max_vol!=0)
		vol=min_vol;
  }
  else if (sum>max_db)
  {
	if (min_gainmic!=0 && max_gainmic!=0)
		mic=min_gainmic;
	if (min_vol!=0 && max_vol!=0)
		vol=max_vol;
  }
  else
  {
    ratio=(sum-min_db)/(max_db-min_db);
	if (min_vol!=0 && max_vol!=0)
		vol=Math.floor((ratio*(max_vol-min_vol))+min_vol);
	if (min_gainmic!=0 && max_gainmic!=0)
	  mic=Math.floor(max_gainmic-(ratio*(max_gainmic-min_gainmic)));
  }
  if ((g_debug&1)!=0)
    console.log("ratio is:"+Math.floor(ratio*100)+"% vol is now:"+vol+"% mic is now:"+mic+"%");
  var skipmic=0;
  var skipvol=0;
  if (g_mic==mic || mic==-1 || typeof mic==='undefined')
   skipmic=1;
  if (g_vol==vol || vol==-1 || typeof vol==='undefined')
    skipvol=1;
  if (skipmic==0 && typeof config.mic_device!='undefined' && config.mic_device!="" &&
      typeof config.mic_card!='undefined' && config.mic_card!="")
  {
    g_mic=mic;
    // Syntax for setsysvolume: setsysvolume 0-65536 device_name mic_card
    // For example: setsysvolume 65536 "réseau de microphones" 2
    cmd_param="setsysvolume"+" "+Math.round(mic*65536/100)+" \""+config.mic_device+"\" "+config.mic_card;
	runSoundControl(cmd_param,SARAH);
  }
  cmd_param="";
  if (skipvol==0)
  {
    g_vol=vol;
	if (typeof config.app_name!='undefined' && config.app_name!="")
	{
		// Syntax for setappvolume: setappvolume app_name|app_pid|app_path 
		// For example: setappvolume WSRMacro_Kinect.exe 0-1
		cmd_param="setappvolume"+" "+config.app_name+" "+(vol/100);
	}
	else
		cmd_param="setsysvolume"+" "+(vol*65536/100);
	runSoundControl(cmd_param,SARAH);
  }
}

var setMainVolume=function(config, SARAH)
{
	if (typeof config.app_name!='undefined' && config.app_name!="")
	{
		var d=new Date();
		for (var t=0;t<5;t++)
		{
			var r=checkDateRange(getTimeRange(t, config),d);
			if (r.result!=false && g_oldvalue!=r.value)
			{
				var cmd_param="";
				g_oldvalue=r.value;
				cmd_param="setsysvolume"+" "+(r.value*65536/100);
				runSoundControl(cmd_param,SARAH);
				g_mainvol=r.value;
				// The first good time range found is the only one used !
				return 0;
			}
		}
	}
	return -1;
}

var getTimeRange=function(index, config)
{
  switch(index)
  {
	case 0:
	    return config.time_range1;
		break;
	case 1:
	    return config.time_range2;
		break;
	case 2:
	    return config.time_range3;
		break;
	case 3:
	    return config.time_range4;
		break;
	case 4:
	    return config.time_range5;
		break;
  }
}

function runSoundControl(params,SARAH)
{
  if (params!="")
  {
    if ((g_debug&2)!=0)
	  console.log("runSoundControl:"+params);
    SARAH.remote({'run' : g_nircmdc, 'runp' : params});
  }
}

