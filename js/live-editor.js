window.LiveEditor = Backbone.View.extend({
    dom: {
        DRAW_CANVAS: ".scratchpad-draw-canvas",
        DRAW_COLOR_BUTTONS: "#draw-widgets a.draw-color-button",
        CANVAS_WRAP: ".scratchpad-canvas-wrap",
        EDITOR: ".scratchpad-editor",
        CANVAS_LOADING: ".scratchpad-canvas-loading",
        BIG_PLAY_LOADING: ".scratchpad-editor-bigplay-loading",
        BIG_PLAY_BUTTON: ".scratchpad-editor-bigplay-button",
        PLAYBAR: ".scratchpad-playbar",
        PLAYBAR_AREA: ".scratchpad-playbar-area",
        PLAYBAR_OPTIONS: ".scratchpad-playbar-options",
        PLAYBAR_LOADING: ".scratchpad-playbar .loading-msg",
        PLAYBAR_PROGRESS: ".scratchpad-playbar-progress",
        PLAYBAR_PLAY: ".scratchpad-playbar-play",
        PLAYBAR_TIMELEFT: ".scratchpad-playbar-timeleft",
        PLAYBAR_UI: ".scratchpad-playbar-play, .scratchpad-playbar-progress",
        OUTPUT_FRAME: "#output-frame",
        OUTPUT_DIV: "#output",
        ALL_OUTPUT: "#output, #output-frame",
        RESTART_BUTTON: "#restart-code"
    },

    mouseCommands: ["move", "over", "out", "down", "up"],
    colors: ["black", "red", "orange", "green", "blue", "lightblue", "violet"],

    defaultOutputWidth: 400,
    defaultOutputHeight: 400,

    editors: {},

    initialize: function(options) {
        this.workersDir = this._qualifyURL(options.workersDir);
        this.externalsDir = this._qualifyURL(options.externalsDir);
        this.imagesDir = this._qualifyURL(options.imagesDir);
        this.soundsDir = options.soundsDir;
        this.execFile = this._qualifyURL(options.execFile);
        this.jshintFile = this._qualifyURL(options.jshintFile ||
            this.externalsDir + "jshint/jshint.js");
        this.redirectUrl = options.redirectUrl;

        this.outputType = options.outputType || "";
        this.editorType = options.editorType || _.keys(this.editors)[0];
        this.editorHeight = options.editorHeight;
        this.initialCode = options.code;
        this.initialVersion = options.version;
        this.settings = options.settings;
        this.validation = options.validation;

        this.recordingCommands = options.recordingCommands;
        this.recordingMP3 = options.recordingMP3;
        this.recordingInit = options.recordingInit || {
            code: this.initialCode,
            version: this.initialVersion
        };

        this.render();

        this.config = new ScratchpadConfig({
            version: options.version
        });

        this.record = new ScratchpadRecord();

        // Set up the Canvas drawing area
        this.drawCanvas = new ScratchpadDrawCanvas({
            el: this.dom.DRAW_CANVAS,
            record: this.record
        });

        this.drawCanvas.on({
            // Drawing has started
            drawStarted: function() {
                // Activate the canvas
                this.$el.find(this.dom.DRAW_CANVAS).show();
            }.bind(this),

            // Drawing has ended
            drawEnded: function() {
                // Hide the canvas
                this.$el.find(this.dom.DRAW_CANVAS).hide();
            }.bind(this),

            // A color has been chosen
            colorSet: function(color) {
                // Deactivate all the color buttons
                this.$el.find(this.dom.DRAW_COLOR_BUTTONS)
                    .removeClass("ui-state-active");

                // If a new color has actually been chosen
                if (color !== null) {
                    // Select that color and activate the button
                    this.$el.find("#" + color).addClass("ui-state-active");
                }
            }.bind(this)
        });

        // Set up the editor
        this.editor = new this.editors[this.editorType]({
            el: this.dom.EDITOR,
            code: this.initialCode,
            autoFocus: options.autoFocus,
            config: this.config,
            record: this.record,
            imagesDir: this.imagesDir,
            soundsDir: this.soundsDir,
            externalsDir: this.externalsDir,
            workersDir: this.workersDir,
            type: this.editorType
        });

        // linting in the webpage environment generates slowparseResults which 
        // is used in the runCode step so skipping linting won't work in that 
        // environment without some more work
        if (this.editorType === "ace_pjs") {
            this.noLint = false;
            this.editor.on("scrubbingStarted", function() {
                this.noLint = true;
            }.bind(this));

            this.editor.on("scrubbingEnded", function() {
                this.noLint = false;
            }.bind(this));
        }

        this.tipbar = new TipBar({
            el: this.$(this.dom.OUTPUT_DIV),
            liveEditor: this
        });

        // Set up the debugger;
        if (options.useDebugger) {
            this.debugger = new ScratchpadDebugger({
                liveEditor: this,
                editor: this.editor.editor
            });
            this.debugger.on("enabled", function (enabled) {
                if (enabled) {
                    this.$el.find(this.dom.RESTART_BUTTON).attr("disabled", "");
                } else {
                    this.$el.find(this.dom.RESTART_BUTTON).removeAttr("disabled");
                }
            }, this);
        }

        var code = options.code;

        // Load the text into the editor
        if (code !== undefined) {
            this.editor.text(code);
            this.editor.originalCode = code;
        }

        // Focus on the editor
        this.editor.focus();

        if (options.cursor) {
            // Restore the cursor position
            this.editor.setCursor(options.cursor);

        } else {
            // Set an initial starting selection point
            this.editor.setSelection({
                start: {row: 0, column: 0},
                end: {row: 0, column: 0}
            });
        }

        // Hide the overlay
        this.$el.find("#page-overlay").hide();

        // Change the width and height of the output frame if it's been
        // changed by the user, via the query string, or in the settings
        this.updateCanvasSize(options.width, options.height);

        if (this.canRecord()) {
            this.$el.find("#record").show();
        }

        this.bind();
        this.setupAudio();
    },

    render: function() {
        this.$el.html(Handlebars.templates["live-editor"]({
            execFile: this.execFile,
            imagesDir: this.imagesDir,
            colors: this.colors
        }));
    },

    bind: function() {
        var self = this;
        var $el = this.$el;
        var dom = this.dom;

        // Make sure that disabled buttons can't still be used
        $el.delegate(".simple-button.disabled, .ui-state-disabled", "click", function(e) {
            e.stopImmediatePropagation();
            return false;
        });

        // Handle the restart button
        $el.delegate(this.dom.RESTART_BUTTON, "click",
            this.restartCode.bind(this));

        this.handleMessagesBound = this.handleMessages.bind(this);
        $(window).on("message", this.handleMessagesBound);

        $el.find("#output-frame").on("load", function() {
            this.outputState = "clean";
            this.markDirty();
        }.bind(this));

        // Whenever the user changes code, execute the code
        this.editor.on("change", function() {
            this.markDirty();
        }.bind(this));

        this.editor.on("userChangedCode", function() {
            if (!this.record.recording && !this.record.playing) {
              this.trigger("userChangedCode");
            }
        }.bind(this));

        this.on("runDone", this.runDone.bind(this));

        // This function will fire once after each synchrynous block which changes the cursor
        // or the current selection. We use it for tag highlighting in webpages.
        var cursorDirty = function() {
            if (self.outputState !== "clean" ) {
                // This will fire after markDirty() itself gets a chance to start a new run
                // So it will just keep resetting itself until one run comes back and there are
                // no changes waiting
                self.once("runDone", cursorDirty);
            } else {
                setTimeout(function() {
                    if (self.editor.getSelectionIndices) {
                        self.postFrame({
                            setCursor: self.editor.getSelectionIndices()
                        });
                    }
                    self.editor.once("changeCursor", cursorDirty);
                }, 0);                
            }
        };
        this.editor.once("changeCursor", cursorDirty);

        this.config.on("versionSwitched", function(e, version) {
            // Re-run the code after a version switch
            this.markDirty();

            // Run the JSHint config
            this.config.runVersion(version, "jshint");
        }.bind(this));

        if (this.hasAudio()) {
            $el.find(".overlay").show();
            $el.find(dom.BIG_PLAY_LOADING).show();
            $el.find(dom.PLAYBAR).show();
        }

        // Set up color button handling
        $el.find(dom.DRAW_COLOR_BUTTONS).each(function() {
            $(this).addClass("ui-button")
                .children().css("background", this.id);
        });

        // Set up toolbar buttons
        if (jQuery.fn.buttonize) {
            $el.buttonize();
        }

        // Handle color button clicks during recording
        $el.on("buttonClick", "a.draw-color-button", function() {
            self.drawCanvas.setColor(this.id);
            self.editor.focus();
        });

        // If the user clicks the disable overlay (which is laid over
        // the editor and canvas on playback) then pause playback.
        $el.on("click", ".disable-overlay", function() {
            self.record.pausePlayback();
        });

        // Set up the playback progress bar
        $el.find(dom.PLAYBAR_PROGRESS).slider({
            range: "min",
            value: 0,
            min: 0,
            max: 100,

            // Bind events to the progress playback bar
            // When a user has started dragging the slider
            start: function() {
                // Prevent slider manipulation while recording
                if (self.record.recording) {
                    return false;
                }

                self.record.seeking = true;

                // Pause playback and remember if we were playing or were paused
                self.wasPlaying = self.record.playing;
                self.record.pausePlayback();
            },

            // While the user is dragging the slider
            slide: function(e, ui) {
                // Slider position is set in seconds
                var sliderPos = ui.value * 1000;

                // Seek the player and update the time indicator
                // Ignore values that match endTime - sometimes the
                // slider jumps and we should ignore those jumps
                // It's ok because endTime is still captured on 'change'
                if (sliderPos !== self.record.endTime()) {
                    self.updateTimeLeft(sliderPos);
                    self.seekTo(sliderPos);
                }
            },

            // When the sliding has stopped
            stop: function(e, ui) {
                self.record.seeking = false;
                self.updateTimeLeft(ui.value * 1000);

                // If we were playing when we started sliding, resume playing
                if (self.wasPlaying) {
                    // Set the timeout to give time for the events to catch up
                    // to the present -- if we start before the events have
                    // finished, the scratchpad editor code will be in a bad
                    // state. Wait roughly a second for events to settle down.
                    setTimeout(function() {
                        self.record.play();
                    }, 1000);
                }
            }
        });

        var handlePlayClick = function() {
            if (self.record.playing) {
                self.record.pausePlayback();
            } else {
                self.record.play();
            }
        };

        // Handle the play button
        $el.find(dom.PLAYBAR_PLAY)
            .off("click.play-button")
            .on("click.play-button", handlePlayClick);

        var handlePlayButton = function() {
            // Show the playback bar and hide the loading message
            $el.find(dom.PLAYBAR_LOADING).hide();
            $el.find(dom.PLAYBAR_AREA).show();

            // Handle the big play button click event
            $el.find(dom.BIG_PLAY_BUTTON)
                .off("click.big-play-button")
                .on("click.big-play-button", function() {
                $el.find(dom.BIG_PLAY_BUTTON).hide();
                handlePlayClick();
            });

            $el.find(dom.PLAYBAR_PLAY).on("click", function() {
                $el.find(dom.BIG_PLAY_BUTTON).hide();
            });

            // Hide upon interaction with the editor
            $el.find(dom.EDITOR).on("click", function() {
                $el.find(dom.BIG_PLAY_BUTTON).hide();
            });

            // Switch from loading to play
            $el.find(dom.BIG_PLAY_LOADING).hide();
            $el.find(dom.BIG_PLAY_BUTTON).show();

            self.off("readyToPlay", handlePlayButton);
        };

        // Set up all the big play button interactions
        this.on("readyToPlay", handlePlayButton);

        // Handle the clear button click during recording
        $el.on("buttonClick", "#draw-clear-button", function() {
            self.drawCanvas.clear();
            self.drawCanvas.endDraw();
            self.editor.focus();
        });

        // Handle the restart button
        $el.on("click", this.dom.RESTART_BUTTON, function() {
            self.record.log("restart");
        });

        // Bind the handler to start a new recording
        $el.find("#record").on("click", function() {
            self.recordHandler(function(err) {
                if (err) {
                    // TODO: Change this:
                    console.error(err);
                }
            });
        });

        // Load the recording playback commands as well, if applicable
        if (this.recordingCommands) {
            // Check the filename to see if a multiplier is specified,
            // of the form audio_x1.3.mp3, which means it's 1.3x as slow
            var url = this.recordingMP3;
            var matches = /_x(1.\d+).mp3/.exec(url);
            var multiplier = parseFloat(matches && matches[1]) || 1;
            this.record.loadRecording({
                init: this.recordingInit,
                commands: this.recordingCommands,
                multiplier: multiplier
            });
        }
    },

    remove: function() {
        $(window).off("message", this.handleMessagesBound);
        this.editor.remove();
    },

    canRecord: function() {
        return true; /* Previously this checked if transloadit was available */
    },

    hasAudio: function() {
        return !!this.recordingMP3;
    },

    setupAudio: function() {
        if (!this.hasAudio()) {
            return;
        }

        var self = this;
        var rebootTimer;

        soundManager.setup({
            url: this.externalsDir + "SoundManager2/swf/",
            debugMode: false,
            // Un-comment this to test Flash on FF:
            // debugFlash: true, preferFlash: true, useHTML5Audio: false,
            // See sm2-container in play-page.handlebars and flashblock.css
            useFlashBlock: true,
            // Sometimes when Flash is blocked or the browser is slower,
            //  soundManager will fail to initialize at first,
            //  claiming no response from the Flash file.
            // To handle that, we attempt a reboot 3 seconds after each 
            //  timeout, clearing the timer if we get an onready during
            //  that time (which happens if user un-blocks flash).
            onready: function() {
                window.clearTimeout(rebootTimer);
                self.audioInit();
            },
            ontimeout: function(error) {
                // The onready event comes pretty soon after the user
                //  clicks the flashblock, but not instantaneous, so 3
                //  seconds seems a good amount of time to give them the
                //  chance to click it before we remove it. It's possible
                //  they may have to click twice sometimes
                //  (but the second time time will work).
                window.clearTimeout(rebootTimer);
                rebootTimer = window.setTimeout(function() {
                    // Clear flashblocker divs
                    self.$el.find("#sm2-container div").remove();
                    soundManager.reboot();
                }, 3000);
            }
        });
        soundManager.beginDelayedInit();

        this.bindRecordHandlers();
    },

    audioInit: function() {
        if (!this.hasAudio()) {
            return;
        }

        var self = this;
        var record = this.record;

        // Reset the wasPlaying tracker
        this.wasPlaying = undefined;

        // Start the play head at 0
        record.time = 0;

        this.player = soundManager.createSound({
            // SoundManager errors if no ID is passed in,
            // even though we don't use it
            // The ID should be a string starting with a letter.
            id: "sound" + (new Date()).getTime(),

            url: this.recordingMP3,

            // Load the audio automatically
            autoLoad: true,

            // While the audio is playing update the position on the progress
            // bar and update the time indicator
            whileplaying: function() {
                self.updateTimeLeft(record.currentTime());

                if (!record.seeking) {
                    // Slider takes values in seconds
                    self.$el.find(self.dom.PLAYBAR_PROGRESS)
                        .slider("option", "value", record.currentTime() / 1000);
                }

                record.trigger("playUpdate");
            }.bind(this),

            // Hook audio playback into Record command playback
            // Define callbacks rather than sending the function directly so
            // that the scope in the Record methods is correct.
            onplay: function() {
                record.play();
            },
            onresume: function() {
                record.play();
            },
            onpause: function() {
                record.pausePlayback();
            },
            onload: function() {
                record.durationEstimate = record.duration = this.duration;
                record.trigger("loaded");
            },
            whileloading: function() {
                record.duration = null;
                record.durationEstimate = this.durationEstimate;
                record.trigger("loading");
            },
            // When audio playback is complete, notify everyone listening
            // that playback is officially done
            onfinish: function() {
                record.stopPlayback();
                record.trigger("playEnded");
            },
            onsuspend: function() {
                // Suspend happens when the audio can't be loaded automatically
                // (such is the case on iOS devices). Thus we trigger a
                // readyToPlay event anyway and let the load happen when the
                // user clicks the play button later on.
                self.trigger("readyToPlay");
            }
        });

        // Wait to start playback until we at least have some
        // bytes from the server (otherwise the player breaks)
        var checkStreaming = setInterval(function() {
            // We've loaded enough to start playing
            if (self.audioReadyToPlay()) {
                clearInterval(checkStreaming);
                self.trigger("readyToPlay");
            }
        }, 16);

        this.bindPlayerHandlers();
    },

    audioReadyToPlay: function() {
        // NOTE(pamela): We can't just check bytesLoaded,
        //  because IE reports null for that 
        // (it seems to not get the progress event)
        // So we've changed it to also check loaded.
        // If we need to, we can reach inside the HTML5 audio element
        //  and check the ranges of the buffered property
        return this.player &&
            (this.player.bytesLoaded > 0 || this.player.loaded);
    },

    bindPlayerHandlers: function() {
        var self = this;
        var record = this.record;

        // Bind events to the Record object, to track when playback events occur
        this.record.bind({
            loading: function() {
                self.updateDurationDisplay();
            },

            loaded: function() {
                // Add an empty command to force the Record playback to
                // keep playing until the audio track finishes playing
                var commands = record.commands;

                if (commands) {
                    commands.push([
                        Math.max(record.endTime(),
                            commands[commands.length - 1][0]), "seek"]);
                }
                self.updateDurationDisplay();
            },

            // When play has started
            playStarted: function() {
                // If the audio player is paused, resume playing
                if (self.player.paused) {
                    self.player.resume();

                // Otherwise we can assume that we need to start playing from the top
                } else if (self.player.playState === 0) {
                    self.player.play();
                }
            },

            // Pause when recording playback pauses
            playPaused: function() {
                self.player.pause();
            }
        });
    },

    bindRecordHandlers: function() {
        var self = this;
        var record = this.record;

        /*
         * Bind events to Record (for recording and playback)
         * and to ScratchpadCanvas (for recording and playback)
         */

        record.bind({
            // Playback of a recording has begun
            playStarted: function(e, resume) {
                // Re-init if the recording version is different from
                // the scratchpad's normal version
                self.config.switchVersion(record.getVersion());

                // We're starting over so reset the editor and
                // canvas to its initial state
                if (!record.recording && !resume) {
                    // Reset the editor
                    self.editor.reset(record.initData.code, false);

                    // Clear and hide the drawing area
                    self.drawCanvas.clear(true);
                    self.drawCanvas.endDraw();
                }

                if (!record.recording) {
                    // Disable the record button during playback
                    self.$el.find("#record").addClass("disabled");
                }

                // During playback disable the restart button
                self.$el.find(self.dom.RESTART_BUTTON).addClass("disabled");

                if (!record.recording) {
                    // Turn on playback-related styling
                    $("html").addClass("playing");

                    // Show an invisible overlay that blocks interactions with
                    // the editor and canvas areas (preventing the user from
                    // being able to disturb playback)
                    self.$el.find(".disable-overlay").show();
                }

                self.editor.unfold();

                // Activate the play button
                self.$el.find(self.dom.PLAYBAR_PLAY)
                    .find("span")
                    .removeClass("glyphicon-play icon-play")
                    .addClass("glyphicon-pause icon-pause");
            },

            playEnded: function() {
                // Re-init if the recording version is different from
                // the scratchpad's normal version
                self.config.switchVersion(this.initialVersion);
            },

            // Playback of a recording has been paused
            playPaused: function() {
                // Turn off playback-related styling
                $("html").removeClass("playing");

                // Disable the blocking overlay
                self.$el.find(".disable-overlay").hide();

                // Allow the user to restart the code again
                self.$el.find(self.dom.RESTART_BUTTON).removeClass("disabled");

                // Re-enable the record button after playback
                self.$el.find("#record").removeClass("disabled");

                // Deactivate the play button
                self.$el.find(self.dom.PLAYBAR_PLAY)
                    .find("span")
                    .addClass("glyphicon-play icon-play")
                    .removeClass("glyphicon-pause icon-pause");
            },

            // Recording has begun
            recordStarted: function() {
                // Let the output know that recording has begun
                self.postFrame({ recording: true });

                self.$el.find("#draw-widgets").removeClass("hidden").show();

                // Hides the invisible overlay that blocks interactions with the
                // editor and canvas areas (preventing the user from being able
                // to disturb the recording)
                self.$el.find(".disable-overlay").hide();

                // Allow the editor to be changed
                self.editor.setReadOnly(false);

                // Turn off playback-related styling
                // (hides hot numbers, for example)
                $("html").removeClass("playing");

                // Reset the canvas to its initial state only if this is the
                // very first chunk we are recording.
                if (record.hasNoChunks()) {
                    self.drawCanvas.clear(true);
                    self.drawCanvas.endDraw();
                }

                // Disable the save button
                self.$el.find("#save-button, #fork-button")
                    .addClass("disabled");

                // Activate the recording button
                self.$el.find("#record").addClass("toggled");
            },

            // Recording has ended
            recordEnded: function() {
                // Let the output know that recording has ended
                self.postFrame({ recording: false });

                if (record.recordingAudio) {
                    self.recordView.stopRecordingAudio();
                }

                // Re-enable the save button
                self.$el.find("#save-button, #fork-button")
                    .removeClass("disabled");

                // Enable playbar UI
                self.$el.find(self.dom.PLAYBAR_UI)
                    .removeClass("ui-state-disabled");

                // Return the recording button to normal
                self.$el.find("#record").removeClass("toggled disabled");

                // Stop any sort of user playback
                record.stopPlayback();

                // Show an invisible overlay that blocks interactions with the
                // editor and canvas areas (preventing the user from being able
                // to disturb the recording)
                self.$el.find(".disable-overlay").show();

                // Turn on playback-related styling (hides hot numbers, for
                // example)
                $("html").addClass("playing");

                // Prevent the editor from being changed
                self.editor.setReadOnly(true);

                self.$el.find("#draw-widgets").addClass("hidden").hide();

                // Because we are recording in chunks, do not reset the canvas
                // to its initial state.
                self.drawCanvas.endDraw();
            }
        });

        // ScratchpadCanvas mouse events to track
        // Tracking: mousemove, mouseover, mouseout, mousedown, and mouseup
        _.each(this.mouseCommands, function(name) {
            // Handle the command during playback
            record.handlers[name] = function(x, y) {
                self.postFrame({
                    mouseAction: {
                        name: name,
                        x: x,
                        y: y
                    }
                });
            };
        });

        // When a restart occurs during playback, restart the output
        record.handlers.restart = function() {
            var $restart = self.$el.find(self.dom.RESTART_BUTTON);

            if (!$restart.hasClass("hilite")) {
                $restart.addClass("hilite green");
                setTimeout(function() {
                    $restart.removeClass("hilite green");
                }, 300);
            }

            self.postFrame({restart: true});
        };

        // Force the recording to sync to the current time of the audio playback
        record.currentTime = function() {
            return self.player ?
                self.player.position : 0;
        };

        // Create a function for retreiving the track end time
        // Note that duration will be set to the duration estimate while
        // the track is still loading, and only set to actual duration
        // once its loaded.
        record.endTime = function() {
            return this.duration || this.durationEstimate;
        };
    },

    recordHandler: function(callback) {
        // If we're already recording, stop
        if (this.record.recording) {
            // Note: We should never hit this case when recording chunks.
            this.recordView.stopRecordingCommands();
            return;
        }

        var saveCode = this.editor.text();

        // You must have some code in the editor before you start recording
        // otherwise the student will be starting with a blank editor,
        // which is confusing
        if (!saveCode) {
            callback({error: "empty"});

        } else if (this.config.curVersion() !== this.config.latestVersion()) {
            callback({error: "outdated"});

        } else if (this.canRecord() && !this.hasAudio()) {
            this.startRecording();
            this.editor.focus();

        } else {
            callback({error: "exists"});
        }
    },

    startRecording: function() {
        this.bindRecordHandlers();

        if (!this.recordView) {
            var $el = this.$el;

            // NOTE(jeresig): Unfortunately we need to do this to make sure
            // that we load the web worker from the same domain as the rest
            // of the site (instead of the domain that the "exec" page is on).
            // This is dumb and a KA-specific bit of functionality that we
            // should change, somehow.
            var workersDir = this.workersDir.replace(/^https?:\/\/[^\/]*/, "");

            this.recordView = new ScratchpadRecordView({
                el: $el.find(".scratchpad-dev-record-row"),
                recordButton: $el.find("#record"),
                saveButton: $el.find("#save-button"),
                record: this.record,
                editor: this.editor,
                config: this.config,
                workersDir: workersDir,
                drawCanvas: this.drawCanvas
            });
        }

        this.recordView.initializeRecordingAudio();
    },

    saveRecording: function(callback, steps) {
        // If no command or audio recording was made, just save the results
        if (!this.record.recorded || !this.record.recordingAudio) {
            return callback();
        }

        this.recordView.getFinalAudioRecording(function(combined) {
            console.info("WOULD UPLOAD", combined.wav);
        });
    },

    // We call this function multiple times, because the
    // endTime value may change as we load the file
    updateDurationDisplay: function() {
        // Do things that are dependent on knowing duration

        // This gets called if we're loading while we're playing,
        // so we need to update with the current time
        this.updateTimeLeft(this.record.currentTime());

        // Set the duration of the progress bar based upon the track duration
        // Slider position is set in seconds
        this.$el.find(this.dom.PLAYBAR_PROGRESS).slider("option", "max",
            this.record.endTime() / 1000);
    },

    // Update the time left in playback of the track
    updateTimeLeft: function(time) {
        // Update the time indicator with a nicely formatted time
        this.$el.find(".scratchpad-playbar-timeleft").text(
            "-" + this.formatTime(this.record.endTime() - time));
    },

    // Utility method for formatting time in minutes/seconds
    formatTime: function(time) {
        var seconds = time / 1000,
            min = Math.floor(seconds / 60),
            sec = Math.floor(seconds % 60);

        if (min < 0 || sec < 0) {
            min = 0;
            sec = 0;
        }

        return min + ":" + (sec < 10 ? "0" : "") + sec;
    },

    // Seek the player to a particular time
    seekTo: function(timeMS) {
        // Don't update the slider position when seeking
        // (since this triggers an event on the #progress element)
        if (!this.record.seeking) {
            this.$el.find(this.dom.PLAYBAR_PROGRESS)
                .slider("option", "value", timeMS / 1000);
        }

        // Move the recording and player positions
        if (this.record.seekTo(timeMS) !== false) {
            this.player.setPosition(timeMS);
        }
    },

    handleMessages: function(e) {
        var event = e.originalEvent;
        var data;

        try {
            data = JSON.parse(event.data);
        } catch (err) {
            // Malformed JSON, we don't care about it
        }

        if (!data) {
            return;
        }

        if (data.type === "debugger") {
            // these messages are handled by ui/debugger.js:listenMessages
            return;
        }

        this.trigger("update", data);

        // Hide loading overlay if output is loaded
        // We previously just looked at data.loaded,
        // but that didn't work for some users (maybe message too early?)
        // so now we also hide if we see data.results

        if (data.loaded || data.results) {
            this.$el.find(this.dom.CANVAS_LOADING).hide();
        }

        // Set the code in the editor
        if (data.code !== undefined) {
            this.editor.text(data.code);
            this.editor.originalCode = data.code;
            this.restartCode();
        }

        // Testing/validation code is being set
        if (data.validate != null) {
            this.validation = data.validate;
        }
        
        if (data.results) {
            this.trigger("runDone");
        }

        if (this.editorType.indexOf("ace_") === 0 && data.results &&
                data.results.assertions) {
            // Remove previously added markers
            var markers = this.editor.editor.session.getMarkers();
            _.each(markers, function(marker, markerId) {
                this.editor.editor.session.removeMarker(markerId);
            }.bind(this));

            var annotations = [];
            for (var i = 0; i < data.results.assertions.length; i++) { 
                var unitTest = data.results.assertions[i];
                annotations.push({
                    row: unitTest.row, 
                    column: unitTest.column, 
                    text: unitTest.text,
                    type: "warning" 
                });
                // Underline the problem line to make it more obvious
                //  if they don't notice the gutter icon
                var AceRange = ace.require("ace/range").Range;
                var line = this.editor.editor.session
                    .getDocument().getLine(unitTest.row);
                this.editor.editor.session.addMarker(
                   new AceRange(unitTest.row, 0, unitTest.row, line.length),
                   "ace_problem_line", "text", false);
           }

           this.editor.editor.session.setAnnotations(annotations);
        }

        if (data.results && _.isArray(data.results.errors)) {
            this.tipbar.toggleErrors(data.results.errors);
        }

        // Set the line visibility in the editor
        if (data.lines !== undefined) {
            this.editor.toggleGutter(data.lines);
        }

        // Restart the execution
        if (data.restart) {
            this.restartCode();
        }

        // Log the recorded action
        if (data.log) {
            this.record.log.apply(this.record, data.log);
        }
    },

    // Extract the origin from the embedded frame location
    postFrameOrigin: function() {
        var match = /^.*:\/\/[^\/]*/.exec(
            this.$el.find("#output-frame").attr("data-src"));

        return match ?
            match[0] :
            window.location.protocol + "//" + window.location.host;
    },

    postFrame: function(data) {
        // Send the data to the frame using postMessage
        this.$el.find("#output-frame")[0].contentWindow.postMessage(
            JSON.stringify(data), this.postFrameOrigin());
    },

    /*
     * Restart the code in the output frame.
     */
    restartCode: function() {
        this.postFrame({ restart: true });
    },

    /*
     * Execute some code in the output frame.
     *
     * A note about the throttling:
     * This limits updates to 50FPS. No point in updating faster than that.
     * 
     * DO NOT CALL THIS DIRECTLY
     * Instead call markDirty because it will handle
     * throttling requests properly.
     */
    runCode: _.throttle(function(code) {
        var options = {
            code: arguments.length === 0 ? this.editor.text() : code,
            cursor: this.editor.getSelectionIndices ? this.editor.getSelectionIndices() : -1,
            validate: this.validation || "",
            noLint: this.noLint,
            version: this.config.curVersion(),
            settings: this.settings || {},
            workersDir: this.workersDir,
            externalsDir: this.externalsDir,
            imagesDir: this.imagesDir,
            soundsDir: this.soundsDir,
            redirectUrl: this.redirectUrl,
            jshintFile: this.jshintFile,
            outputType: this.outputType
        };

        this.trigger("runCode", options);

        this.postFrame(options);
    }, 20),
    
    markDirty: function() {
        // They're typing. Hide the tipbar to give them a chance to fix things up
        this.tipbar.hide();
        if (this.outputState === "clean") {
            // We will run at the end of this code block
            // This stops replace from trying to execute code
            // between deleting the old code and adding the new code
            setTimeout(this.runCode.bind(this), 0);
            this.outputState = "running";

            // 500ms is an arbitrary timeout. Hopefully long enough for reasonable programs
            // to execute, but short enough for editor to not freeze
            this.runTimeout = setTimeout(function() { this.trigger("runDone"); }.bind(this), 500);
        } else {
            this.outputState = "dirty";
        }
    },
    // This will either be called when we receive the results
    // Or it will timeout.
    runDone: function() {
        clearTimeout(this.runTimeout);
        var lastOutputState = this.outputState;
        this.outputState = "clean";
        if (lastOutputState === "dirty") {
            this.markDirty();
        }
    },
    // This stops us from sending  any updates until
    // Reset output state to clean as a part of the frame load handler
    outputState: "dirty",

    getScreenshot: function(callback) {
        // Unbind any handlers this function may have set for previous
        // screenshots
        $(window).unbind("message.getScreenshot");

        // We're only expecting one screenshot back
        $(window).bind("message.getScreenshot", function(e) {
            // Only call if the data is actually an image!
            if (/^data:/.test(e.originalEvent.data)) {
                callback(e.originalEvent.data);
            }
        });

        // Ask the frame for a screenshot
        this.postFrame({ screenshot: true });
    },

    updateCanvasSize: function(width, height) {
        width = width || this.defaultOutputWidth;
        height = height || this.defaultOutputHeight;

        this.$el.find(this.dom.CANVAS_WRAP).width(width);
        this.$el.find(this.dom.ALL_OUTPUT).height(height);

        // Set the editor height to be the same as the canvas height
        this.$el.find(this.dom.EDITOR).height(this.editorHeight || height);

        this.trigger("canvasSizeUpdated", {
            width: width,
            height: height
        });
    },

    getScreenshot: function(callback) {
        // Unbind any handlers this function may have set for previous
        // screenshots
        $(window).off("message.getScreenshot");
    
        // We're only expecting one screenshot back
        $(window).on("message.getScreenshot", function(e) {
            // Only call if the data is actually an image!
            if (/^data:/.test(e.originalEvent.data)) {
                callback(e.originalEvent.data);
            }
        });
    
        // Ask the frame for a screenshot
        this.postFrame({ screenshot: true });
    },

    undo: function() {
        this.editor.undo();
    },

    _qualifyURL: function(url) {
        var a = document.createElement("a");
        a.href = url;
        return a.href;
    }
});

LiveEditor.registerEditor = function(name, editor) {
    LiveEditor.prototype.editors[name] = editor;
};
