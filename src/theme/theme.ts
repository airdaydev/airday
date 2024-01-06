enum defaultThemeNames {
    Paper = 'paper',
    Botanic = 'botanic',
    Night = 'night',
}

function setTheme(name: defaultThemeNames) {
    document.body.setAttribute('data-theme', name);
}
