# term: the user's .zshrc from their real ZDOTDIR (see .zshenv), then the
# integration, then (unless this is a login shell, whose .zlogin comes next)
# ZDOTDIR handed back.
ZDOTDIR=$__bro_term_user_zdotdir
# The system zshrc ran with ZDOTDIR still this directory, and macOS's sets
# HISTFILE=${ZDOTDIR:-$HOME}/.zsh_history: the user's history would be kept
# here. Where it named this directory, it means the user's.
[[ ${HISTFILE-} == $__bro_term_zdotdir/.zsh_history ]] && HISTFILE=$ZDOTDIR/.zsh_history
[[ -r $ZDOTDIR/.zshrc ]] && source $ZDOTDIR/.zshrc
__bro_term_user_zdotdir=$ZDOTDIR
ZDOTDIR=$__bro_term_zdotdir

source $__bro_term_zdotdir/bro-term.zsh

if [[ ! -o login ]]; then
    __bro_term_handback
fi
