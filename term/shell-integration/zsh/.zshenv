# term shell integration for zsh: ZDOTDIR points at this directory so zsh
# reads these files, and each one runs the user's own file of the same name
# from their real ZDOTDIR (BRO_TERM_USER_ZDOTDIR, else $HOME). .zshrc (or
# .zlogin, for a login shell) installs the hooks and hands ZDOTDIR back.

__bro_term_zdotdir=$ZDOTDIR
if [[ -n ${BRO_TERM_USER_ZDOTDIR-} ]]; then
    __bro_term_had_zdotdir=1
    ZDOTDIR=$BRO_TERM_USER_ZDOTDIR
else
    ZDOTDIR=$HOME
fi
unset BRO_TERM_USER_ZDOTDIR
[[ -r $ZDOTDIR/.zshenv ]] && source $ZDOTDIR/.zshenv
# The user's .zshenv may move ZDOTDIR; where it points now is theirs.
__bro_term_user_zdotdir=$ZDOTDIR
if [[ -o interactive ]]; then
    ZDOTDIR=$__bro_term_zdotdir
else
    # A non-interactive shell reads no more startup files: hand back now.
    if [[ -n ${__bro_term_had_zdotdir-} || $__bro_term_user_zdotdir != $HOME ]]; then
        export ZDOTDIR=$__bro_term_user_zdotdir
    else
        unset ZDOTDIR
    fi
    unset __bro_term_zdotdir __bro_term_user_zdotdir __bro_term_had_zdotdir
fi
