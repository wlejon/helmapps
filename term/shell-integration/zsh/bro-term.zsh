# term shell integration for zsh: prompt marks (OSC 133 A and B), the
# command's start (C) with its command line (OSC 633;E) and end with its exit
# code (D), and the directory (OSC 7). Sourced by this directory's .zshrc.

__bro_term_handback() {
    if [[ -n ${__bro_term_had_zdotdir-} || $__bro_term_user_zdotdir != $HOME ]]; then
        export ZDOTDIR=$__bro_term_user_zdotdir
    else
        unset ZDOTDIR
    fi
    unset __bro_term_zdotdir __bro_term_user_zdotdir __bro_term_had_zdotdir
    unfunction __bro_term_handback
}

[[ -n ${__bro_term_loaded-} ]] && return
__bro_term_loaded=1
unset BRO_TERM_SHELL_INTEGRATION

# First precmd hook: the exit status, before another hook changes it.
__bro_term_precmd() {
    local s=$?
    if [[ -n ${__bro_term_ran-} ]]; then
        printf '\e]133;D;%s\a' "$s"
    fi
    unset __bro_term_ran
    printf '\e]7;file://%s%s\e\\' "$HOST" "${PWD//\%/%25}"
    return $s
}

# Last precmd hook: wrap PS1 in the prompt marks, again if a prompt
# framework rebuilt it.
__bro_term_ps1() {
    if [[ $PS1 != *'133;A'* ]]; then
        PS1=$'%{\e]133;A\a%}'"$PS1"$'%{\e]133;B\a%}'
    fi
}

__bro_term_preexec() {
    __bro_term_ran=1
    local c=$1
    c=${c//\\/\\\\}
    c=${c//;/\\x3b}
    c=${c//$'\n'/\\x0a}
    c=${c//$'\r'/\\x0d}
    c=${c//$'\e'/\\x1b}
    c=${c//$'\a'/\\x07}
    printf '\e]633;E;%s\a\e]133;C\a' "$c"
}

precmd_functions=(__bro_term_precmd ${precmd_functions[@]} __bro_term_ps1)
preexec_functions+=(__bro_term_preexec)
