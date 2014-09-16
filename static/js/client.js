
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Client-side code to connect to server and handle incoming data
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    var isInitialData = false;
    var socket = io.connect();

    socket.on('now', function (d) {
        now = d;
        var dateTime = new Date(now);
        $('#currentTime').text(formatTime(dateTime));

        // Dim the screen by reducing the opacity when at nighttime
        if (browserSettings.nightMode) {
            if (opacity.current != opacity.NIGHT && (dateTime.getHours() > 21 || dateTime.getHours() < 7)) {
                $('body').css({ 'opacity': opacity.NIGHT });
            } else {
                $('body').css({ 'opacity': opacity.DAY });
            }
        }
    });

    socket.on('sgv', function (d) {
        if (d.length > 1) {
            errorCode = d.length >= 5 ? d[4] : undefined;

            // change the next line so that it uses the prediction if the signal gets lost (max 1/2 hr)
            if (d[0].length) {
                latestSGV = d[0][d[0].length - 1];

                //TODO: alarmHigh/alarmLow probably shouldn't be here
                if (browserSettings.alarmHigh) {
                    $('.container .current').toggleClass('high', latestSGV.y > 180);
                }
                if (browserSettings.alarmLow) {
                    $('.container .current').toggleClass('low', latestSGV.y < 70);
                }
            }
            data = d[0].map(function (obj) {
                return { date: new Date(obj.x), y: obj.y, sgv: scaleBg(obj.y), direction: obj.direction, color: sgvToColor(obj.y)}
            });
            // TODO: This is a kludge to advance the time as data becomes stale by making old predictor clear (using color = 'none')
            // This shouldn't have to be sent and can be fixed by using xScale.domain([x0,x1]) function with
            // 2 days before now as x0 and 30 minutes from now for x1 for context plot, but this will be
            // required to happen when "now" event is sent from websocket.js every minute.  When fixed,
            // remove all "color != 'none'" code
            data = data.concat(d[1].map(function (obj) { return { date: new Date(obj.x), y: obj.y, sgv: scaleBg(obj.y), color: 'none'} }));
            data = data.concat(d[2].map(function (obj) { return { date: new Date(obj.x), y: obj.y, sgv: scaleBg(obj.y), color: 'red'} }));
            
            data.forEach(function (d) {
                if (d.y < 39)
                    d.color = "transparent";
            });

            treatments = d[3];
            treatments.forEach(function (d) {
                d.created_at = new Date(d.created_at);
            });

            if (!isInitialData) {
                isInitialData = true;
                initializeCharts();
            }
            else {
                updateChart(false);
            }
        }
    });

    function sgvToColor(sgv) {
        var color = 'grey';

        if (browserSettings.theme == "colors") {
            if (sgv > targetTop) {
                color = 'yellow';
            } else if (sgv >= targetBottom && sgv <= targetTop) {
                color = '#4cff00';
            } else if (sgv < targetBottom) {
                color = 'red';
            }
        }

        return color;
    }
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Alarms and Text handling
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    socket.on('connect', function () {
        console.log('Client connected to server.')
    });
    socket.on('alarm', function () {
        if (browserSettings.alarmHigh) {
            console.log("Alarm raised!");
            currentAlarmType = 'alarm';
            generateAlarm(alarmSound);
        }
        brushInProgress = false;
        updateChart(false);
    });
    socket.on('urgent_alarm', function () {
        if (browserSettings.alarmLow) {
            console.log("Urgent alarm raised!");
            currentAlarmType = 'urgent_alarm';
            generateAlarm(urgentAlarmSound);
        }
        brushInProgress = false;
        updateChart(false);
    });
    socket.on('clear_alarm', function () {
        if (alarmInProgress) {
            console.log('clearing alarm');
            stopAlarm();
        }
    });


    $('#testAlarms').click(function(event) {
        d3.select('.audio.alarms audio').each(function (data, i) {
            var audio = this;
            playAlarm(audio);
            setTimeout(function() {
                audio.pause();
            }, 4000);
        });
        event.preventDefault();
    });

    function generateAlarm(file) {
        alarmInProgress = true;
        var selector = '.audio.alarms audio.' + file;
        d3.select(selector).each(function (d, i) {
            var audio = this;
            playAlarm(audio);
            $(this).addClass('playing');
        });
        var element = document.getElementById('bgButton');
        element.hidden = '';
        var element1 = document.getElementById('noButton');
        element1.hidden = 'true';
        $('.container .currentBG').text();

        if ($(window).width() <= WIDTH_TIME_HIDDEN) {
            $(".time").hide();
        }
    }

    function playAlarm(audio) {
        // ?mute=true disables alarms to testers.
        if (querystring.mute != "true") {
            audio.play();
        } else {
            showNotification("Alarm is muted per your request. (?mute=true)");
        }
    }

    function stopAlarm(isClient, silenceTime) {
        alarmInProgress = false;
        var element = document.getElementById('bgButton');
        element.hidden = 'true';
        element = document.getElementById('noButton');
        element.hidden = '';
        d3.select('audio.playing').each(function (d, i) {
            var audio = this;
            audio.pause();
            $(this).removeClass('playing');
        });

        $(".time").show();

        // only emit ack if client invoke by button press
        if (isClient) {
            socket.emit('ack', currentAlarmType || 'alarm', silenceTime);
            brushed(false);
        }
    }

    function timeAgo(offset) {
        var parts = {},
            MINUTE = 60,
            HOUR = 3600,
            DAY = 86400,
            WEEK = 604800;

        //offset = (MINUTE * MINUTES_SINCE_LAST_UPDATE_WARN) + 60
        //offset = (MINUTE * MINUTES_SINCE_LAST_UPDATE_URGENT) + 60

        if (offset <= MINUTE)              parts = { label: 'now' };
        if (offset <= MINUTE * 2)          parts = { label: '1 min ago' };
        else if (offset < (MINUTE * 60))   parts = { value: Math.round(Math.abs(offset / MINUTE)), label: 'mins' };
        else if (offset < (HOUR * 2))      parts = { label: '1 hr ago' };
        else if (offset < (HOUR * 24))     parts = { value: Math.round(Math.abs(offset / HOUR)), label: 'hrs' };
        else if (offset < DAY)             parts = { label: '1 day ago' };
        else if (offset < (DAY * 7))       parts = { value: Math.round(Math.abs(offset / DAY)), label: 'day' };
        else if (offset < (WEEK * 52))     parts = { value: Math.round(Math.abs(offset / WEEK)), label: 'week' };
        else                               parts = { label: 'a long time ago' };

        if (offset > (MINUTE * MINUTES_SINCE_LAST_UPDATE_URGENT)) {
            var lastEntry = $("#lastEntry");
            lastEntry.removeClass("warn");
            lastEntry.addClass("urgent");

            $(".bgStatus").removeClass("current");
        } else if (offset > (MINUTE * MINUTES_SINCE_LAST_UPDATE_WARN)) {
            var lastEntry = $("#lastEntry");
            lastEntry.removeClass("urgent");
            lastEntry.addClass("warn");
        } else {
            $(".bgStatus").addClass("current");
            $("#lastEntry").removeClass("warn urgent");
        }

        if (parts.value)
            return parts.value + ' ' + parts.label + ' ago';
        else
            return parts.label;

    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //draw a compact visualization of a treatment (carbs, insulin)
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function drawTreatment(treatment, scale, showValues) {
        var carbs = treatment.carbs;
        var insulin = treatment.insulin;
        var CR = treatment.CR;

        var R1 = Math.sqrt(Math.min(carbs, insulin * CR)) / scale,
            R2 = Math.sqrt(Math.max(carbs, insulin * CR)) / scale,
            R3 = R2 + 8 / scale;

        var arc_data = [
            { 'element': '', 'color': '#9c4333', 'start': -1.5708, 'end': 1.5708, 'inner': 0, 'outer': R1 },
            { 'element': '', 'color': '#d4897b', 'start': -1.5708, 'end': 1.5708, 'inner': R1, 'outer': R2 },
            { 'element': '', 'color': 'transparent', 'start': -1.5708, 'end': 1.5708, 'inner': R2, 'outer': R3 },
            { 'element': '', 'color': '#3d53b7', 'start': 1.5708, 'end': 4.7124, 'inner': 0, 'outer': R1 },
            { 'element': '', 'color': '#5d72c9', 'start': 1.5708, 'end': 4.7124, 'inner': R1, 'outer': R2 },
            { 'element': '', 'color': 'transparent', 'start': 1.5708, 'end': 4.7124, 'inner': R2, 'outer': R3 }
        ];

        if (carbs < insulin * CR) arc_data[1].color = 'transparent';
        if (carbs > insulin * CR) arc_data[4].color = 'transparent';
        if (carbs > 0) arc_data[2].element = Math.round(carbs) + ' g';
        if (insulin > 0) arc_data[5].element = Math.round(insulin * 10) / 10 + ' U';

        var arc = d3.svg.arc()
            .innerRadius(function (d) { return 5 * d.inner; })
            .outerRadius(function (d) { return 5 * d.outer; })
            .endAngle(function (d) { return d.start; })
            .startAngle(function (d) { return d.end; });

        var treatmentDots = focus.selectAll('treatment-dot')
            .data(arc_data)
            .enter()
            .append('g')
            .attr('transform', 'translate(' + xScale(treatment.x) + ', ' + yScale(scaleBg(treatment.y)) + ')');

        var arcs = treatmentDots.append('path')
            .attr('class', 'path')
            .attr('fill', function (d, i) { return d.color; })
            .attr('id', function (d, i) { return 's' + i; })
            .attr('d', arc);


        // labels for carbs and insulin
        if (showValues) {
            var label = treatmentDots.append('g')
                .attr('class', 'path')
                .attr('id', 'label')
                .style('fill', 'white');
            label.append('text')
                .style('font-size', 30 / scale)
                .style('font-family', 'Arial')
                .attr('text-anchor', 'middle')
                .attr('dy', '.35em')
                .attr('transform', function (d) {
                    d.outerRadius = d.outerRadius * 2.1;
                    d.innerRadius = d.outerRadius * 2.1;
                    return 'translate(' + arc.centroid(d) + ')';
                })
                .text(function (d) { return d.element; })
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // function to predict
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function predictAR(actual) {
        var ONE_MINUTE = 60 * 1000;
        var FIVE_MINUTES = 5 * ONE_MINUTE;
        var predicted = [];
        var BG_REF = scaleBg(140);
        var BG_MIN = scaleBg(36);
        var BG_MAX = scaleBg(400);
        // these are the one sigma limits for the first 13 prediction interval uncertainties (65 minutes)
        var CONE = [0.020, 0.041, 0.061, 0.081, 0.099, 0.116, 0.132, 0.146, 0.159, 0.171, 0.182, 0.192, 0.201];
        if (actual.length < 2) {
            var y = [Math.log(actual[0].sgv / BG_REF), Math.log(actual[0].sgv / BG_REF)];
        } else {
            var elapsedMins = (actual[1].date - actual[0].date) / ONE_MINUTE;
            if (elapsedMins < 5.1) {
                y = [Math.log(actual[0].sgv / BG_REF), Math.log(actual[1].sgv / BG_REF)];
            } else {
                y = [Math.log(actual[0].sgv / BG_REF), Math.log(actual[0].sgv / BG_REF)];
            }
        }
        var AR = [-0.723, 1.716];
        var dt = actual[1].date.getTime();
        var predictedColor = 'blue';
        if (browserSettings.theme == "colors") {
            predictedColor = 'cyan';
        }
        for (var i = 0; i < CONE.length; i++) {
            y = [y[1], AR[0] * y[0] + AR[1] * y[1]];
            dt = dt + FIVE_MINUTES;
            // Add 2000 ms so not same point as SG
            predicted[i * 2] = {
                date: new Date(dt + 2000),
                sgv: Math.max(BG_MIN, Math.min(BG_MAX, Math.round(BG_REF * Math.exp((y[1] - 2 * CONE[i]))))),
                color: predictedColor
            };
            // Add 4000 ms so not same point as SG
            predicted[i * 2 + 1] = {
                date: new Date(dt + 4000),
                sgv: Math.max(BG_MIN, Math.min(BG_MAX, Math.round(BG_REF * Math.exp((y[1] + 2 * CONE[i]))))),
                color: predictedColor
            };
            predicted.forEach(function (d) {
                if (d.sgv < BG_MIN)
                    d.color = "transparent";
            })
        }
        return predicted;
    }
})();
