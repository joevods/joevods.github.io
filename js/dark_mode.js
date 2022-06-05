"use strict";

function init_vod_theme() {
    let nightmode = !localStorage.getItem('darkMode') === 'false';
    set_vod_theme(nightmode);
}

function set_vod_theme(nightmode) {
    document.querySelector("body").classList.toggle("dark", nightmode);
    document.querySelector(".topbar").classList.toggle("topbar-dark", nightmode);
    document.querySelector(".content").classList.toggle("content-dark", nightmode);
    document.querySelector(".chat-outer-wrapper").classList.toggle("chat-outer-wrapper-dark", nightmode);
}

function toggle_action() {
    if(localStorage.getItem('darkMode') === 'true') {
        localStorage.setItem('darkMode', 'false');
    } else {
        localStorage.setItem('darkMode', 'true');
    }
    init_vod_theme();
}
