# term: the user's .zshrc from their real ZDOTDIR (see .zshenv), then the
# integration, then (unless this is a login shell, whose .zlogin comes next)
# ZDOTDIR handed back.
ZDOTDIR=$__bro_term_user_zdotdir
[[ -r $ZDOTDIR/.zshrc ]] && source $ZDOTDIR/.zshrc
__bro_term_user_zdotdir=$ZDOTDIR
ZDOTDIR=$__bro_term_zdotdir

source $__bro_term_zdotdir/bro-term.zsh

if [[ ! -o login ]]; then
    __bro_term_handback
fi
